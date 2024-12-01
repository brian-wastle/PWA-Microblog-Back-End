import { Client } from 'pg';

// Database client setup
const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: 5432,
});

// Lambda handler
export const handler = async (event) => {
  const { type, content, mediaUrls = [], videoUrl, videoSize } = JSON.parse(event.body);

  if (!content || !type) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Post type and content are required' }),
    };
  }

  try {
    // Connect to the database
    await client.connect();

    // Handling 'text' post type
    if (type === 'text') {
      const query = `INSERT INTO posts (type, content, created_at) VALUES ($1, $2, NOW()) RETURNING id;`;
      const values = [type, content];
      await client.query(query, values);

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Text post created successfully' }),
      };
    }

    // Handling 'photoAlbum' post type
    if (type === 'photoAlbum') {
      if (mediaUrls.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ error: 'At least one photo URL is required' }) };
      }

      // Save photo album posts
      const query = `INSERT INTO posts (type, content, media_urls, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id;`;
      const values = [type, content, JSON.stringify(mediaUrls)];
      await client.query(query, values);

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Photo album post created successfully' }),
      };
    }

    // Handling 'video' post type
    if (type === 'video') {
      if (!videoUrl || !videoSize) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Video URL and video size are required for video posts' }) };
      }

      // Save video post
      const query = `INSERT INTO posts (type, content, video_url, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id;`;
      const values = [type, content, videoUrl];
      await client.query(query, values);

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Video post created successfully' }),
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid post type' }),
    };
  } catch (error) {
    console.error('Error creating post:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error creating post' }) };
  } finally {
    // Ensure the DB connection is closed after each request
    await client.end();
  }
};
