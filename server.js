{
  "name": "globalchat-backend",
  "version": "1.0.0",
  "description": "GlobalChat Connect — M-Pesa Daraja STK Push Backend",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "init-db": "node db/init.js"
  },
  "dependencies": {
    "axios": "^1.6.7",
    "bcryptjs": "^2.4.3",
    "better-sqlite3": "^9.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.18.3",
    "express-rate-limit": "^7.2.0",
    "express-validator": "^7.0.1",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "morgan": "^1.10.0",
    "uuid": "^9.0.1",
    "winston": "^3.12.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
