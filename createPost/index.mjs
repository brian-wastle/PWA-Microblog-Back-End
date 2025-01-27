import pkg from 'pg';
const { Client } = pkg;
import { DynamoDBClient, PutItemCommand, ScanCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';


const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:4200",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const s3 = new S3Client({ region: process.env.REGION_NAME });

// DynamoDB client
const dynamoClient = new DynamoDBClient({ region: process.env.REGION_NAME});

// PostgreSQL client
let dbClient;

export const handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  if (event.httpMethod === "OPTIONS") {
    return createResponse(200, { message: "CORS preflight response" });
  }

  try {
    const { type, content, mediaUrls = [], videoUrl } = JSON.parse(event.body || "{}");

    // Verify types
    const validTypes = ["text", "photoAlbum", "video"];
    if (!type || !validTypes.includes(type) || !content) {
      return createResponse(400, { error: "Invalid input" });
    }

    await getDatabaseClient();

    // Optimize images if the type is "photoAlbum"
    let optimizedMediaUrls = mediaUrls;
    if (type === "photoAlbum" && mediaUrls.length > 0) {
      const bucket = process.env.S3_BUCKET_NAME;
      optimizedMediaUrls = await Promise.all(
        mediaUrls.map(async (key) => {
          const optimizedKey = await optimizeImage(bucket, key);
          // Return full URL
          return `https://${bucket}.s3.amazonaws.com/${optimizedKey}`;
        })
      );

      console.log("Optimized media URLs:", optimizedMediaUrls);
    }

    const { query, values } = generatePost(type, content, optimizedMediaUrls, videoUrl);
    const postId = await createPost(query, values);

    // Retrieve the post to validate creation
    const newPost = await validatePost(postId);

    console.log("Newly created post:", newPost);

    // Update DynamoDB cache
    await updateRecentPosts(newPost);

    return createResponse(200, { message: "Post Created Successfully", postId });
  } catch (error) {
    console.error("Error creating post:", error.message, error.stack);
    return createResponse(500, { message: "Internal Server Error" });
  }
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

// Create PostgreSQL query
const generatePost = (type, content, mediaUrls, videoUrl) => {
  switch (type) {
    case "text":
      return {
        query: `INSERT INTO posts (id, type, content, createdAt) 
                VALUES (gen_random_uuid(), $1, $2, NOW()) RETURNING id, createdAt;`,
        values: [type, content],
      };
    case "photoAlbum":
      return {
        query: `INSERT INTO posts (id, type, content, mediaUrls, createdAt) 
                VALUES (gen_random_uuid(), $1, $2, $3, NOW()) RETURNING id, createdAt;`,
        values: [type, content, JSON.stringify(mediaUrls)],
      };
    case "video":
      return {
        query: `INSERT INTO posts (id, type, content, videoUrl, createdAt) 
                VALUES (gen_random_uuid(), $1, $2, $3, NOW()) RETURNING id, createdAt;`,
        values: [type, content, videoUrl],
      };
    default:
      throw new Error("Invalid post type");
  }
};

const updateRecentPosts = async (newPost) => {
  try {
    const formattedCreatedAt = new Date(newPost.createdat).toISOString();

    const dynamoItem = {
      id: { S: newPost.id },
      type: { S: newPost.type },
      content: { S: newPost.content },
      createdAt: { S: formattedCreatedAt },
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
    await dynamoClient.send(new PutItemCommand(putParams));
    console.log("PutItem success");

    // Verify cache
    const scanParams = {
      TableName: process.env.TABLE_NAME,
      ProjectionExpression: "id, createdAt",
    };
    const scanResult = await dynamoClient.send(new ScanCommand(scanParams));
    console.log("Scan Result:", JSON.stringify(scanResult, null, 2));

    // Clean-up cache
    const items = (scanResult.Items || []).map((item) => ({
      id: item.id?.S,
      createdAt: item.createdAt?.S,
    }));
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (items.length > 10) {
      const cacheOverflow = items.slice(10);
      for (const item of cacheOverflow) {
        const deleteParams = {
          TableName: process.env.TABLE_NAME,
          Key: {
            id: { S: item.id },
            createdAt: { S: item.createdAt },
          },
        };
        console.log("Deleting item:", JSON.stringify(deleteParams));
        await dynamoClient.send(new DeleteItemCommand(deleteParams));
      }
    }

    console.log("Recent posts updated successfully");
  } catch (error) {
    console.error("Error updating recent posts:", error);
    throw error;
  }
};

const optimizeImage = async (bucket, key) => {
  try {
    if (key.startsWith("http")) {
      const urlObj = new URL(key);
      key = decodeURIComponent(urlObj.pathname.substring(1));
    }
    console.log(`Retrieving image from S3: Bucket=${bucket}, Key=${key}`);

    // Retrieve stored image
    const getObjectParams = { Bucket: bucket, Key: key };
    const imageData = await s3.send(new GetObjectCommand(getObjectParams));
    const imageBody = await streamToBuffer(imageData.Body);

    // Optimize image 
    const optimizedData = await sharp(imageBody)
      .resize({ width: 1200 }) // Resize to 1500px width
      .png({ quality: 80 }) // Compress to 80% quality
      .toBuffer();
    console.log("Image optimized with sharp");

    // Overwrite the original upload
    const putObjectParams = {
      Bucket: bucket,
      Key: key,
      Body: optimizedData,
      ContentType: 'image/png',
    };
    await s3.send(new PutObjectCommand(putObjectParams));
    console.log("Optimized image uploaded back to S3");

    return key;
  } catch (error) {
    console.error("Error optimizing image:", error);
    throw error;
  }
};

const streamToBuffer = async (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", (err) => reject(err));
  });
};

const createPost = async (query, values) => {
  const result = await dbClient.query(query, values);
  const postId = result.rows[0]?.id;
  if (!postId) {
    throw new Error("Failed to create post");
  }
  return postId;
}

const validatePost = async (postId) => {
  const fetchPostQuery = `
    SELECT id, type, content, createdat, mediaurls, videourl
    FROM posts
    WHERE id = $1;
  `;
  const postResult = await dbClient.query(fetchPostQuery, [postId]);
  const newPost = postResult.rows[0];
  
  if (!newPost) {
    throw new Error("Failed to retrieve newly created post");
  }
  newPost.createdat = new Date(newPost.createdat).toISOString();

  return newPost;
};


const createResponse = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body),
});