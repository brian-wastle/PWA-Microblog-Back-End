import pkg from 'pg';
const { Client } = pkg;
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "http://localhost:4200",
  "Access-Control-Allow-Methods": "OPTIONS,GET",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Create a singleton RDS client
let dbClient = null;

const getDbClient = async () => {
  if (!dbClient) {
    dbClient = new Client({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: 5432,
    });

    await dbClient.connect();
    console.log('Connected to PostgreSQL');
  }
  return dbClient;
};

// DynamoDB client (stateless, can be reused globally)
const dynamoClient = new DynamoDBClient({ region: process.env.REGION_NAME });

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
    const lastCreatedAt = queryParams.lastCreatedAt;

    if (!lastCreatedAt) {
      // Step 1: Pull cached data from DynamoDB (initial request)
      const scanParams = {
        TableName: process.env.TABLE_NAME,
        Limit: limit,
      };
      const cacheData = await dynamoClient.send(new ScanCommand(scanParams));

      const posts = (cacheData.Items || []).map((item) => ({
        id: item.id.S,
        type: item.type.S,
        content: item.content.S,
        createdAt: item.createdAt.S,
        mediaUrls: item.mediaUrls?.L?.map((url) => url.S) || [],
        videoUrl: item.videoUrl?.S || null,
      }));

      posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(posts),
      };
    } else {
      // Step 2: Pull data from RDS (follow-up requests)
      const client = await getDbClient();
      const query = `
        SELECT id, type, content, createdat, mediaurls, videourl
        FROM posts
        WHERE createdat < $1::timestamp(3) AT TIME ZONE 'UTC'
        ORDER BY createdat DESC
        LIMIT $2;
      `;

      const isoDate = new Date(lastCreatedAt).toISOString();
      const res = await client.query(query, [isoDate, limit]);

      const posts = res.rows.map((row) => ({
        id: row.id,
        type: row.type,
        content: row.content,
        createdAt: row.createdat.toISOString(),
        mediaUrls: row.mediaurls || [],
        videoUrl: row.videourl || null,
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(posts),
      };
    }
  } catch (error) {
    console.error('Error fetching posts:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Error fetching posts' }),
    };
  }
};
