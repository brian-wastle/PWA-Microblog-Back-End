import AWS from 'aws-sdk'; 
const { S3 } = AWS;
const s3 = new S3();

const corsHeaders = {
    "Access-Control-Allow-Origin": "http://localhost:4200",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'CORS preflight response' })
        };
    }
  
    const { type, content, mediaFiles = [], videoFile, videoParts = 1 } = JSON.parse(event.body);
  
    if (!content || !type) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Post type and content are required' }),
        };
    }

    try {
        let presignedUrls = [];
        
        if (type === 'photoAlbum' && mediaFiles.length > 0) {
            // Generate presigned URLs for photos
            presignedUrls = await generatePresignedUrls(mediaFiles);
        }
        
        if (type === 'video' && videoFile) {
            // Generate presigned URLs for multipart video upload
            presignedUrls = await generateMultipartPresignedUrls(videoFile.name, videoParts);
        }

        // Return the presigned URLs to the frontend for uploading the files
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Presigned URLs generated successfully', presignedUrls }),
        };
    } catch (error) {
        console.error('Error generating presigned URLs:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Error generating presigned URLs' }),
        };
    }
};

// Function to generate presigned URLs for multiple photos
const generatePresignedUrls = async (fileNames) => {
    const presignedUrls = [];

    for (const fileName of fileNames) {
        const key = `photos/${Date.now()}-${fileName}`;  // Unique key for each file

        const params = {
            Bucket: 'streaming-video-pwa',
            Key: key,
            Expires: 60 * 15,  // Presigned URL expiration time (5 minutes)
            ContentType: 'image/png',
        };

        const signedUrl = await s3.getSignedUrlPromise('putObject', params);
        presignedUrls.push({ fileName, signedUrl });
    }

    return presignedUrls;
};

// Function to generate presigned URLs for a multipart video upload
const generateMultipartPresignedUrls = async (fileName, parts) => {
    const presignedUrls = [];
    const baseKey = `videos/${Date.now()}-${fileName}`; // Unique key for the video

    // Generate presigned URLs for each video part
    for (let partNumber = 1; partNumber <= parts; partNumber++) {
        const partKey = `${baseKey}.part${partNumber}`;
        
        const params = {
            Bucket: 'streaming-video-pwa',
            Key: partKey,
            Expires: 60 * 5,  // Presigned URL expiration time (5 minutes)
            ContentType: 'video',
        };

        const signedUrl = await s3.getSignedUrlPromise('uploadPart', params);
        presignedUrls.push({ partNumber, signedUrl });
    }

    return presignedUrls;
};

