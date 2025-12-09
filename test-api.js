
import https from 'https';
import fs from 'fs';

const data = JSON.stringify({
    model: 'provider-4/imagen-3.5',
    prompt: 'A cute cat',
    num_images: 1,
    size: '1024x1024'
});

const options = {
    hostname: 'api.a4f.co',
    path: '/v1/images/generations',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ddc-a4f-07842c4bb9ae4099b39833a26a4acf46',
        'Content-Length': data.length
    }
};

console.log('Sending request to', options.hostname + options.path);

const req = https.request(options, (res) => {
    console.log('Status Code:', res.statusCode);

    let responseBody = '';

    res.on('data', (chunk) => {
        responseBody += chunk;
    });

    res.on('end', () => {
        console.log('Body received, writing to file...');
        const result = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: responseBody
        };
        fs.writeFileSync('api-response.json', JSON.stringify(result, null, 2));
        console.log('Done.');
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(data);
req.end();
