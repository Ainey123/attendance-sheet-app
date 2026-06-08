// api/_middleware.js
// CORS headers for all API routes
module.exports = (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-passcode');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
};
