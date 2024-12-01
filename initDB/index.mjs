import { Client } from 'pg';

export async function handler(event) {
  const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: 5432, // Default PostgreSQL port
  });

  try {
    // Connect to the database
    await client.connect();

    // Create the 'posts' table (if it doesn't already exist)
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY,
        type VARCHAR(20) CHECK (type IN ('text', 'photoAlbum', 'video')) NOT NULL,
        content TEXT NOT NULL,
        mediaUrls JSONB,
        videoUrl VARCHAR(255),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    
    // Run the create table query
    await client.query(createTableQuery);

    // Optional: Verify that the table exists by fetching some data (for testing)
    const res = await client.query('SELECT * FROM posts LIMIT 1');
    await client.end();

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Table created successfully or already exists', data: res.rows }),
    };
  } catch (err) {
    console.log('Error setting up the database:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Database setup failed' }),
    };
  }
}
