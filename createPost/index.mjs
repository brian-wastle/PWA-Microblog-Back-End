import pkg from 'pg';
const { Client } = pkg;
import { DynamoDBClient, PutItemCommand, ScanCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';

// CORS
const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "http://localhost:4200",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

// DynamoDB client
const dynamoClient = new DynamoDBClient({ region: process.env.REGION_NAME, endpoint: process.env.CACHE_ENDPOINT });

// PostgreSQL client
let dbClient;
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

// Create PostgreSQL query
const generatePost = (type, content, mediaUrls, videoUrl) => {
  switch (type) {
    case "text":
      return {
        query: `INSERT INTO posts (id, type, content, createdAt) VALUES (gen_random_uuid(), $1, $2, NOW()) RETURNING id;`,
        values: [type, content],
      };
    case "photoAlbum":
      return {
        query: `INSERT INTO posts (id, type, content, mediaUrls, createdAt) VALUES (gen_random_uuid(), $1, $2, $3, NOW()) RETURNING id;`,
        values: [type, content, JSON.stringify(mediaUrls)],
      };
    case "video":
      return {
        query: `INSERT INTO posts (id, type, content, videoUrl, createdAt) VALUES (gen_random_uuid(), $1, $2, $3, NOW()) RETURNING id;`,
        values: [type, content, videoUrl],
      };
    default:
      throw new Error("Invalid post type");
  }
};

// Use DynamoDB to manage "cache" on new post
const updateRecentPosts = async (newPost) => {
  try {
    const dynamoItem = {
      id: { S: newPost.id },
      type: { S: newPost.type },
      content: { S: newPost.content },
      createdAt: { S: newPost.createdat },
    };

    // Handle mediaUrls and videoUrl based on type
    if (newPost.type === "photoAlbum") {
      dynamoItem.mediaUrls = { L: (newPost.mediaurls).map((url) => ({ S: url })) };
    }
    if (newPost.type === "video") {
      dynamoItem.videoUrl = { S: newPost.videourl };
    }

    const putParams = {
      TableName: process.env.TABLE_NAME,
      Item: dynamoItem,
    };

    console.log("DynamoDB item to insert:", JSON.stringify(dynamoItem));
    
    await dynamoClient.send(new PutItemCommand(putParams));
    console.log("PutItem success");

    // Get cache and trim to 10 posts
    const scanParams = {
      TableName: process.env.TABLE_NAME,
      ProjectionExpression: "id, createdAt",
    };
    const scanResult = await dynamoClient.send(new ScanCommand(scanParams));

    const items = (scanResult.Items || []).map((item) => ({
      id: item.id.S,
      createdAt: new Date(item.createdAt.S).getTime(),
    }));
    items.sort((a, b) => b.createdAt - a.createdAt);
    
    if (items.length > 10) {
      const cacheOverflow = items.slice(10);
      for (const item of cacheOverflow) {
        const deleteParams = {
          TableName: process.env.TABLE_NAME,
          Key: {
            id: { S: item.id },
          },
        };
        await dynamoClient.send(new DeleteItemCommand(deleteParams));
      }
    }

    console.log("Recent posts updated successfully");
  } catch (error) {
    console.error("Error updating recent posts:", error);
    throw error;
  }
};

export const handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  // CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: "CORS preflight response" }),
    };
  }

  try {
    const { type, content, mediaUrls = [], videoUrl } = JSON.parse(event.body || "{}");

    // Verify types
    const validTypes = ["text", "photoAlbum", "video"];
    if (!type || !validTypes.includes(type) || !content) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid input" }),
      };
    }

    const dbClient = await getDatabaseClient();

    // Generate SQL query
    const { query, values } = generatePost(type, content, mediaUrls, videoUrl);

    // Insert post to database
    const result = await dbClient.query(query, values);
    const postId = result.rows[0]?.id;

    if (!postId) {
      throw new Error("Failed to create post");
    }

    // Retrieve the newly created post
    const fetchPostQuery = `
      SELECT id, type, content, createdat, mediaurls, videourl
      FROM posts
      WHERE id = $1
    `;
    const postResult = await dbClient.query(fetchPostQuery, [postId]);
    const newPost = postResult.rows[0];

    if (!newPost) {
      throw new Error("Failed to retrieve newly created post");
    }

    console.log("Newly created post:", newPost);
    // Update DynamoDB cache
    await updateRecentPosts(newPost);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Post created successfully", postId }),
    };
  } catch (error) {
    console.error("Error creating post:", error.message, error.stack);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};
