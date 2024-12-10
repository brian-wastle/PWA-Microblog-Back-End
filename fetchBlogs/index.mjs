import pkg from 'pg';
const { Client } = pkg;
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

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

const dynamoClient = new DynamoDBClient({ region: process.env.REGION_NAME });

export const handler = async (event) => {
  const limit = 10; // Number of posts in each db request

  if (event.httpMethod === 'OPTIONS') {
    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'CORS preflight response' })
    };
  }

  try {
    // Fetch first 10 posts from DynamoDB "cache"
    const scanParams = {
      TableName: process.env.TABLE_NAME,
      Limit: limit,
    };
    const cacheData = await dynamoClient.send(new ScanCommand(scanParams));

    if (cacheData.Items && cacheData.Items.length < limit) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(cacheData.Items),
      };
    }

    // Query posts from RDS db on scroll
    const query = `SELECT * FROM posts WHERE createdAt < (SELECT createdAt FROM posts ORDER BY createdAt DESC LIMIT 1 OFFSET $1) ORDER BY createdAt DESC LIMIT $2;`;
    const res = await client.query(query, [limit, 10]);
    const posts = res.rows;

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
