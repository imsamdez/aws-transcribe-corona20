import dotenv from "dotenv";

dotenv.config();

export default class Environnement {
  public static AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
  public static AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
  public static AWS_S3_BUCKET_AUDIO_FILE = process.env.AWS_S3_BUCKET_AUDIO_FILE;
}
