// Import TensorFlow.js
const tf = require('@tensorflow/tfjs');
require('@tensorflow/tfjs-backend-webgl');

// Sentiment Analysis Model
class SentimentAnalyzer {
    constructor() {
        this.model = null;
        this.tokenizer = null;
        this.vocabSize = 10000;
        this.maxLength = 100;
        this.embeddingDim = 16;
        this.trainingData = [];
    }

    async initialize() {
        // Create a simple LSTM model for sentiment analysis
        this.model = tf.sequential();
        
        // Add embedding layer
        this.model.add(tf.layers.embedding({
            inputDim: this.vocabSize,
            outputDim: this.embeddingDim,
            inputLength: this.maxLength
        }));
        
        // Add LSTM layer
        this.model.add(tf.layers.lstm({
            units: 32,
            returnSequences: false
        }));
        
        // Add dense layers
        this.model.add(tf.layers.dense({
            units: 16,
            activation: 'relu'
        }));
        
        this.model.add(tf.layers.dense({
            units: 3, // 3 classes: positive, negative, neutral
            activation: 'softmax'
        }));
        
        // Compile model
        this.model.compile({
            optimizer: 'adam',
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });

        // Initialize tokenizer
        this.tokenizer = new Map();
        this.loadVocabulary();
    }

    async loadVocabulary() {
        // Load pre-trained vocabulary or create from training data
        // This is a simplified version - in production, you'd want to load a proper vocabulary
        const commonWords = [
            'thank', 'thanks', 'great', 'good', 'excellent', 'awesome', 'happy', 'satisfied',
            'bad', 'poor', 'terrible', 'awful', 'horrible', 'worst', 'hate', 'angry', 'upset',
            'inquiry', 'question', 'request', 'information', 'details', 'regarding', 'about'
        ];
        
        commonWords.forEach((word, index) => {
            this.tokenizer.set(word, index + 1); // Reserve 0 for padding
        });
    }

    preprocessText(text) {
        // Convert text to lowercase and remove special characters
        text = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        
        // Tokenize and convert to sequence
        const words = text.split(' ');
        const sequence = words.map(word => this.tokenizer.get(word) || 0);
        
        // Pad or truncate sequence
        if (sequence.length < this.maxLength) {
            sequence.push(...Array(this.maxLength - sequence.length).fill(0));
        } else {
            sequence.length = this.maxLength;
        }
        
        return tf.tensor2d([sequence]);
    }

    async predictSentiment(text) {
        if (!this.model) {
            await this.initialize();
        }

        const input = this.preprocessText(text);
        const prediction = await this.model.predict(input).array();
        input.dispose();

        // Get the class with highest probability
        const sentimentScores = prediction[0];
        const maxIndex = sentimentScores.indexOf(Math.max(...sentimentScores));
        
        return {
            sentiment: ['negative', 'neutral', 'positive'][maxIndex],
            confidence: sentimentScores[maxIndex],
            scores: {
                negative: sentimentScores[0],
                neutral: sentimentScores[1],
                positive: sentimentScores[2]
            }
        };
    }

    async trainModel(newData) {
        // Add new training data
        this.trainingData.push(...newData);
        
        // Prepare training data
        const xs = [];
        const ys = [];
        
        for (const {text, label} of this.trainingData) {
            const sequence = this.preprocessText(text);
            xs.push(sequence);
            
            // Convert label to one-hot encoding
            const labelIndex = ['negative', 'neutral', 'positive'].indexOf(label);
            const oneHot = Array(3).fill(0);
            oneHot[labelIndex] = 1;
            ys.push(oneHot);
        }
        
        const xsTensor = tf.concat(xs);
        const ysTensor = tf.tensor2d(ys);
        
        // Train the model
        await this.model.fit(xsTensor, ysTensor, {
            epochs: 10,
            batchSize: 32,
            validationSplit: 0.2,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    console.log(`Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}, accuracy = ${logs.acc.toFixed(4)}`);
                }
            }
        });
        
        // Cleanup
        xsTensor.dispose();
        ysTensor.dispose();
    }

    // Save model and training data
    async saveModel() {
        await this.model.save('indexeddb://sentiment-model');
        localStorage.setItem('sentiment-training-data', JSON.stringify(this.trainingData));
    }

    // Load saved model and training data
    async loadModel() {
        try {
            this.model = await tf.loadLayersModel('indexeddb://sentiment-model');
            const savedData = localStorage.getItem('sentiment-training-data');
            if (savedData) {
                this.trainingData = JSON.parse(savedData);
            }
        } catch (error) {
            console.log('No saved model found, initializing new model');
            await this.initialize();
        }
    }
}

// Category Classification Model
class CategoryClassifier {
    constructor() {
        this.model = null;
        this.categories = ['pricing', 'features', 'technical', 'support', 'trial'];
        this.trainingData = [];
    }

    async initialize() {
        // Create a simple neural network for category classification
        this.model = tf.sequential();
        
        this.model.add(tf.layers.dense({
            units: 64,
            activation: 'relu',
            inputShape: [100] // Using same vocabulary size as sentiment analyzer
        }));
        
        this.model.add(tf.layers.dropout(0.2));
        
        this.model.add(tf.layers.dense({
            units: 32,
            activation: 'relu'
        }));
        
        this.model.add(tf.layers.dense({
            units: this.categories.length,
            activation: 'softmax'
        }));
        
        this.model.compile({
            optimizer: 'adam',
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });
    }

    async predictCategory(text, sentimentAnalyzer) {
        if (!this.model) {
            await this.initialize();
        }

        const input = await sentimentAnalyzer.preprocessText(text);
        const prediction = await this.model.predict(input).array();
        input.dispose();

        const scores = prediction[0];
        const maxIndex = scores.indexOf(Math.max(...scores));
        
        return {
            category: this.categories[maxIndex],
            confidence: scores[maxIndex],
            scores: Object.fromEntries(
                this.categories.map((cat, i) => [cat, scores[i]])
            )
        };
    }

    async trainModel(newData, sentimentAnalyzer) {
        this.trainingData.push(...newData);
        
        const xs = [];
        const ys = [];
        
        for (const {text, category} of this.trainingData) {
            const sequence = await sentimentAnalyzer.preprocessText(text);
            xs.push(sequence);
            
            const categoryIndex = this.categories.indexOf(category);
            const oneHot = Array(this.categories.length).fill(0);
            oneHot[categoryIndex] = 1;
            ys.push(oneHot);
        }
        
        const xsTensor = tf.concat(xs);
        const ysTensor = tf.tensor2d(ys);
        
        await this.model.fit(xsTensor, ysTensor, {
            epochs: 10,
            batchSize: 32,
            validationSplit: 0.2
        });
        
        xsTensor.dispose();
        ysTensor.dispose();
    }

    async saveModel() {
        await this.model.save('indexeddb://category-model');
        localStorage.setItem('category-training-data', JSON.stringify(this.trainingData));
    }

    async loadModel() {
        try {
            this.model = await tf.loadLayersModel('indexeddb://category-model');
            const savedData = localStorage.getItem('category-training-data');
            if (savedData) {
                this.trainingData = JSON.parse(savedData);
            }
        } catch (error) {
            console.log('No saved model found, initializing new model');
            await this.initialize();
        }
    }
}

// Export the classes
window.SentimentAnalyzer = SentimentAnalyzer;
window.CategoryClassifier = CategoryClassifier; 