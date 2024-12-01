import { Client } from 'pg';
import Redis from 'ioredis';

// Connect to PostgreSQL
const client = new Client({
  user: 'your-db-user',
  host: 'your-db-host',
  database: 'your-db-name',
  password: 'your-db-password',
  port: 5432,
});

// Connect to Redis (ElastiCache)
const redis = new Redis({
  host: process.env.CACHE_NAME,
  port: 6379,
});

exports.handler = async (event) => {
  const { page = 1, limit = 10 } = event.queryStringParameters;
  const offset = (page - 1) * limit;

  // Cache key based on pagination parameters
  const cacheKey = `posts:page:${page}:limit:${limit}`;

  try {
    // Check Redis cache
    const cachedPosts = await redis.get(cacheKey);

    if (cachedPosts) {
      console.log('Cache hit');
      return {
        statusCode: 200,
        body: cachedPosts,
      };
    }

    console.log('Cache miss, querying database');
    // If no cache, query PostgreSQL
    await client.connect();

    const query = `
      SELECT * FROM posts 
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2;
    `;
    const values = [limit, offset];
    const res = await client.query(query, values);

    const posts = res.rows;

    await redis.set(cacheKey, JSON.stringify(posts), 'EX', 3600); //Cache expiration

    return {
      statusCode: 200,
      body: JSON.stringify(posts),
    };
  } catch (error) {
    console.error('Error fetching posts:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error fetching posts' }),
    };
  } finally {
    await client.end();
  }
};
