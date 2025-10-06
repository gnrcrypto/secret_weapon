require('dotenv').config();
console.log('All env vars:', process.env);
console.log('---');
console.log('DB_PASSWORD:', process.env.DB_PASSWORD);
console.log('PRIVATE_KEY:', process.env.PRIVATE_KEY ? 'EXISTS' : 'MISSING');
