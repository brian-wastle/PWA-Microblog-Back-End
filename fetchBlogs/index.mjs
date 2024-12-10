import pkg from 'pg';
const { Client } = pkg;
import Redis from 'ioredis';

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "http://localhost:4200",
  "Access-Control-Allow-Methods": "OPTIONS,GET",
  "Access-Control-Allow-Headers": "Content-Type",
};

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: 5432,
});

let redis;

const initializeRedis = () => {
  if (!redis) {
    redis = new Redis({
      host: 'pwa-site-cache-redis-piqea1.serverless.use1.cache.amazonaws.com',
      port: 6379,
      connectTimeout: 10000,
      maxRetriesPerRequest: 3,
      tls: {},
    });

    redis.on('error', (err) => {
      console.error('[Redis Error]', err);
    });
  }
};
initializeRedis();

export const handler = async (event) => {
  const redisKey = 'recent:posts';
  const limit = 10;

  try {
    // Fetch first 10 posts from Redis
    const cachedPosts = await redis.lrange(redisKey, 0, -1);

    if (cachedPosts.length < limit) {
      console.log(JSON.stringify(cachedPosts.map(JSON.parse)));
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(cachedPosts.map(JSON.parse)),
      };
    }

    // Query further posts on scroll
    const query = `SELECT * FROM posts WHERE createdAt < (SELECT createdAt FROM posts ORDER BY createdAt DESC LIMIT 1 OFFSET $1) ORDER BY createdAt DESC LIMIT $2;`;
    const res = await client.query(query, [limit, 10]);
    const posts = res.rows;
    console.log(JSON.stringify(posts));
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
  }
};