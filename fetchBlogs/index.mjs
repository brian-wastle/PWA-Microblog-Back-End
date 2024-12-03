import dns from 'dns/promises';

import pkg from 'pg';
const { Client } = pkg;
import Redis from 'ioredis';

// Connect to PostgreSQL
const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: 5432,
});

// Connect to Redis (ElastiCache)


const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "http://localhost:4200",
  "Access-Control-Allow-Methods": "OPTIONS,GET",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler = async (event) => {
  const redis = new Redis({
    host: process.env.CACHE_ENDPOINT,
    port: 6379,
    connectTimeout: 10000, // 10 seconds
    maxRetriesPerRequest: 3, // Reduce retries
    tls: {},
  });

  const { page = 1, limit = 10 } = event.queryStringParameters;
  const offset = (page - 1) * limit;


  try {
    const cacheKey = `posts:page:${page}:limit:${limit}`;
    const cachedPosts = await redis.get(cacheKey);

    if (cachedPosts) {
      console.log('Cache hit');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: cachedPosts,
      };
    }

    console.log('Cache miss, querying database');
    await client.connect();

    const query = `
      SELECT * FROM posts 
      ORDER BY createdAt DESC
      LIMIT $1 OFFSET $2;
    `;
    const values = [limit, offset];
    const res = await client.query(query, values);

    const posts = res.rows;

    await redis.set(cacheKey, JSON.stringify(posts), 'EX', 3600);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(posts),
    };
  } catch (error) {
    console.error('Error fetching posts:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Error fetching posts' }),
    };
  } finally {
    await client.end();
  }
};
