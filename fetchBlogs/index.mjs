import pkg from 'pg';
const { Client } = pkg;
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "http://localhost:4200",
  "Access-Control-Allow-Methods": "OPTIONS,GET",
  "Access-Control-Allow-Headers": "Content-Type",
};

// PostgreSQL client
const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: 5432,
});

// DynamoDB client
const dynamoClient = new DynamoDBClient({ region: process.env.REGION_NAME, endpoint: process.env.CACHE_ENDPOINT });

export const handler = async (event) => {
  const limit = 10;

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'CORS preflight response' }),
    };
  }

  try {
    const queryParams = event.queryStringParameters || {};
    const lastCreatedAt = queryParams.lastcreatedat; // Adjusted to lowercase

    // Fetch from DynamoDB cache if lastCreatedAt is not provided
    if (!lastCreatedAt) {
      const scanParams = {
        TableName: process.env.TABLE_NAME,
        Limit: limit,
      };
      const cacheData = await dynamoClient.send(new ScanCommand(scanParams));

      // Map DynamoDB items to a consistent structure
      const posts = (cacheData.Items || []).map((item) => ({
        id: item.id.S,
        type: item.type.S,
        content: item.content.S,
        createdAt: item.createdAt.S,
        mediaUrls: item.mediaUrls?.L?.map((url) => url.S) || [],
        videoUrl: item.videoUrl?.S || null,
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(posts),
      };
    }

    // Fetch older posts from PostgreSQL
    const query = `
      SELECT id, type, content, createdat, mediaurls, videourl
      FROM posts
      WHERE createdat < $1
      ORDER BY createdat DESC
      LIMIT $2;
    `;
    const res = await client.query(query, [lastCreatedAt, limit]);
    const posts = res.rows.map((row) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      createdAt: row.createdat,
      mediaUrls: row.mediaurls || [],
      videoUrl: row.videourl || null,
    }));
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
