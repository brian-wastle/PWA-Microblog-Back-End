import pkg from 'pg';
import Redis from 'ioredis';
const { Client } = pkg;

let dbClient, redis;

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "http://localhost:4200",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const getDatabaseClient = async () => {
  if (!dbClient) {
    dbClient = new Client({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: 5432,
    });
    await dbClient.connect();
  }
  return dbClient;
};

const getRedisClient = () => {
  if (!redis) {
    redis = new Redis({
      host: 'pwa-site-cache-redis-piqea1.serverless.use1.cache.amazonaws.com',
      port: 6379,
      connectTimeout: 10000,
      maxRetriesPerRequest: 3,
      tls: {}
    });

    redis.on('error', (err) => {
      console.error('[Redis Error]', err);
    });
  }
  return redis;
};

const generatePost = (type, content, mediaUrls, videoUrl) => {
  switch (type) {
    case 'text':
      return {
        query: `INSERT INTO posts (id, type, content, createdAt) VALUES (gen_random_uuid(), $1, $2, NOW()) RETURNING id;`,
        values: [type, content],
      };
    case 'photoAlbum':
      return {
        query: `INSERT INTO posts (id, type, content, mediaUrls, createdAt) VALUES (gen_random_uuid(), $1, $2, $3, NOW()) RETURNING id;`,
        values: [type, content, JSON.stringify(mediaUrls)],
      };
    case 'video':
      return {
        query: `INSERT INTO posts (id, type, content, videoUrl, createdAt) VALUES (gen_random_uuid(), $1, $2, $3, NOW()) RETURNING id;`,
        values: [type, content, videoUrl],
      };
    default:
      throw new Error('Invalid post type');
  }
};

export const handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  //CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'CORS preflight response' }),
    };
  }

  try {
    const { type, content, mediaUrls = [], videoUrl } = JSON.parse(event.body || "{}");

    const validTypes = ['text', 'photoAlbum', 'video'];
    if (!type || !validTypes.includes(type) || !content) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid input' }),
      };
    }

    const dbClient = await getDatabaseClient();
    const redis = getRedisClient();

    const { query, values } = generatePost(type, content, mediaUrls, videoUrl);

    // Insert post to DB
    const result = await dbClient.query(query, values);
    const postId = result.rows[0]?.id;

    if (!postId) {
      throw new Error('Failed to create post');
    }

    // Confirm insertion
    const fetchPostQuery = 'SELECT * FROM posts WHERE id = $1';
    const postResult = await dbClient.query(fetchPostQuery, [postId]);
    const newPost = postResult.rows[0];

    if (!newPost) {
      throw new Error('Failed to retrieve newly created post');
    }

    // Update cache
    const redisKey = 'recent:posts';
    await redis.lpush(redisKey, JSON.stringify(newPost));
    await redis.ltrim(redisKey, 0, 9);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Post created successfully', postId }),
    };
  } catch (error) {
    console.error('Error creating post:', error.message, error.stack);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};
