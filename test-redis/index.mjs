import Redis from "ioredis";

const redis = new Redis({
  host: process.env.CACHE_ENDPOINT,
  port: 6379,
  connectTimeout: 10000,
  maxRetriesPerRequest: 3,
  tls: {},
});

export const handler = async (event) => {
  try {
    await redis.set("test-key", "test-value");
    const value = await redis.get("test-key");
    console.log("Redis test value:", value);
    return {
      statusCode: 200,
      body: `Redis connection successful: ${value}`,
    };
  } catch (err) {
    console.error("Redis connection failed:", err);
    return {
      statusCode: 500,
      body: "Redis connection failed",
    };
  } finally {
    redis.disconnect();
  }
};


import https from 'https';
import dns from 'dns';

export const handler2 = async (event) => {
  const hostname = process.env.CACHE_ENDPOINT;
  const port = 6379;

  return new Promise((resolve) => {
    dns.lookup(hostname, (err, address) => {
      if (err) {
        resolve(`DNS lookup failed: ${err.message}`);
      } else {
        const options = {
          hostname: address,
          port,
          method: 'CONNECT',
        };

        const req = https.request(options, (res) => {
          resolve(`Connection test response: ${res.statusCode}`);
        });

        req.on('error', (error) => {
          resolve(`Connection test failed: ${error.message}`);
        });

        req.end();
      }
    });
  });
};