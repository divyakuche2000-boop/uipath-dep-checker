'use strict';

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const uploadRouter = require('./routes/upload');
const analysisRouter = require('./routes/analysis');

const app = express();

// Trust proxy (fixes express-rate-limit validation error)
app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false
  },
  message: {
    error: 'Too many requests, please try again later.'
  }
});

app.use(limiter);

app.use(
  cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api/upload', uploadRouter);
app.use('/api/analysis', analysisRouter);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.use((err, _req, res, _next) => {
  console.error('[Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'An internal error occurred.'
  });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Automation Project Validator backend running on http://127.0.0.1:${PORT}`);
});