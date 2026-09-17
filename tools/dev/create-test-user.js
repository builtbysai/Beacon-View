const http = require('http');
const data = JSON.stringify({ email: 'test@example.com', password: 'a very long password 123' });
const req = http.request({ hostname: 'localhost', port: 5173, path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
  console.log('Status:', res.statusCode);
  res.on('data', (d) => process.stdout.write(d));
});
req.on('error', (e) => console.error(e));
req.write(data); req.end();
