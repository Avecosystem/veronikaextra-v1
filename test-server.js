
import http from 'http';

const data = JSON.stringify({
    prompt: 'A futuristic city',
    numberOfImages: 1
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/generate',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

console.log('Sending request to', options.hostname + ':' + options.port + options.path);

const req = http.request(options, (res) => {
    console.log('Status Code:', res.statusCode);

    let responseBody = '';

    res.on('data', (chunk) => {
        responseBody += chunk;
    });

    res.on('end', () => {
        console.log('Response:', responseBody);
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(data);
req.end();
