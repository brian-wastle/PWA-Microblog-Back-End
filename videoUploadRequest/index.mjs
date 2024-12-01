import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({ region: "us-east-1" });

export const handler = async (event) => {
    const bucketName = process.env.VIDEO_BUCKET_NAME;
    const { fileName, fileType } = JSON.parse(event.body);

    const params = {
        Bucket: bucketName,
        Key: `videos/${Date.now()}_${fileName}`,
        ContentType: fileType,
        ACL: "public-read",
    };

    try {
        const url = await getSignedUrl(s3Client, new PutObjectCommand(params), { expiresIn: 3600 });
        return {
            statusCode: 200,
            body: JSON.stringify({ uploadUrl: url }),
        };
    } catch (error) {
        console.error("Error generating pre-signed URL:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error generating pre-signed URL", error: error.message }),
        };
    }
};
