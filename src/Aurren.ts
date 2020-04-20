import fs from "fs";
import path from "path";
import parser from "parse-filepath";
import Enquirer from "enquirer";
import AWS from "aws-sdk";
import crypto from "crypto";
import ora from "ora";
import Axios from "axios";

import Environnement from "@Env";

const s3 = new AWS.S3({ apiVersion: "2006-03-01" });
const TranscribeService = new AWS.TranscribeService({
  apiVersion: "2017-10-26",
});
const spinner = ora("Transcription in progress 🤘");

/** Why Aurren ? https://www.wowhead.com/quest=9538/learning-the-language */
export default class Aurren {
  private m_audioFiles = new Array<parser.ParsedPath>();
  private m_confAudioFilesExt = [".mp4"];
  private m_confAudioFileDir = "audios";
  private m_confLanguageCode = ["es-ES"];

  public audioFile: parser.ParsedPath | null = null;
  public audioFileLanguageCode = "";

  constructor() {
    this.loadAudioFiles();
  }

  getAudioFilePath(): string {
    if (this.audioFile == null) return "";
    return path.join(
      __dirname,
      "..",
      this.m_confAudioFileDir,
      this.audioFile.base
    );
  }
  getTranscriptionJobName(): string {
    return `TS-${crypto
      .createHash("md5")
      .update((this.audioFile as parser.ParsedPath).basename)
      .digest("hex")}`;
  }

  private loadAudioFiles(): void {
    let audioFiles: string[] | parser.ParsedPath[];

    try {
      audioFiles = fs.readdirSync(
        path.join(__dirname, "..", this.m_confAudioFileDir)
      );
    } catch (err) {
      console.error(
        `Aurren - loadAudioFiles - Fail to read audio files dir! ${err.message}`
      );
      throw new Error(err);
    }
    audioFiles = audioFiles
      .map(parser)
      .filter((f) /** file */ => this.m_confAudioFilesExt.includes(f.ext));
    this.m_audioFiles = audioFiles;
  }

  private async askUserAudio(): Promise<void> {
    const prompt: { audioFile: string } = await Enquirer.prompt({
      type: "select",
      name: "audioFile",
      message: "Choose an audio file",
      choices: this.m_audioFiles.map((f) => f.name),
    });

    if (prompt.audioFile != null && prompt.audioFile.length !== 0) {
      this.audioFile = this.m_audioFiles.find(
        (f) => f.name === prompt.audioFile
      ) as parser.ParsedPath;
      return;
    }
    console.error(`Could not get the chosen audio file!`);
    process.exit();
  }
  private async askUserLanguageCode(): Promise<void> {
    const prompt: { languageCode: string } = await Enquirer.prompt({
      type: "select",
      name: "languageCode",
      message: "Choose the language",
      choices: this.m_confLanguageCode,
    });

    if (prompt.languageCode != null && prompt.languageCode.length !== 0) {
      this.audioFileLanguageCode = prompt.languageCode;
      return;
    }
    console.error(`Could not get the chosen language code!`);
    process.exit();
  }

  private async transcribe(): Promise<void> {
    const uploadOpts: AWS.S3.PutObjectRequest = {
      Body: "",
      Key: (this.audioFile as parser.ParsedPath).basename,
      Bucket: Environnement.AWS_S3_BUCKET_AUDIO_FILE as string,
    };
    const jobName = this.getTranscriptionJobName();
    const transcriptionOpts: AWS.TranscribeService.StartTranscriptionJobRequest = {
      LanguageCode: this.audioFileLanguageCode,
      Media: {
        MediaFileUri: `s3://${Environnement.AWS_S3_BUCKET_AUDIO_FILE}/`,
      },
      TranscriptionJobName: jobName,
    };
    const readStream = fs.createReadStream(this.getAudioFilePath());
    let uploadResult = null;
    let jobResult = null;

    // Check if a transcription for the given file exists
    if ((jobResult = await this.getTranscriptionJob(jobName)) != null)
      return this.transcribeOutput(jobResult);
    readStream.on("error", (err) =>
      console.error(
        `Aurren - transcribe - Error when reading audio file! ${err.message}`
      )
    );
    // Upload audio file to S3
    uploadOpts.Body = readStream;
    uploadResult = await s3.upload(uploadOpts).promise();
    transcriptionOpts.Media.MediaFileUri += uploadResult.Key;
    // Start transcription job
    spinner.start();
    jobResult = await TranscribeService.startTranscriptionJob(
      transcriptionOpts
    ).promise();
    // Poll the status of the job
    jobResult = await this.waitForAwsTranscribeJobToFinish(
      transcriptionOpts.TranscriptionJobName
    );
    spinner.succeed(
      `Job finished with code ${jobResult.TranscriptionJobStatus}`
    );
    // Output result
    this.transcribeOutput(jobResult);
  }
  private async transcribeOutput(
    jobResult: AWS.TranscribeService.TranscriptionJob
  ) {
    const result = await Axios.get(
      (jobResult.Transcript as AWS.TranscribeService.Transcript)
        .TranscriptFileUri as string
    );

    console.log(result.data.results.transcripts[0].transcript);
  }
  private async getTranscriptionJob(
    jobName: string
  ): Promise<AWS.TranscribeService.TranscriptionJob | null> {
    let jobResult = null;

    try {
      jobResult = await TranscribeService.getTranscriptionJob({
        TranscriptionJobName: jobName,
      }).promise();
      if (jobResult.TranscriptionJob != null) {
        jobResult = jobResult.TranscriptionJob;
      } else {
        jobResult = null;
      }
    } catch (err) {
      jobResult = null;
    }

    return jobResult;
  }
  private async waitForAwsTranscribeJobToFinish(
    jobName: string
  ): Promise<AWS.TranscribeService.TranscriptionJob> {
    return new Promise((resolve, reject) => {
      const refInterval = setInterval(async () => {
        let jobData = null;

        jobData = await TranscribeService.getTranscriptionJob({
          TranscriptionJobName: jobName,
        }).promise();
        if (
          jobData.TranscriptionJob?.TranscriptionJobStatus === "IN_PROGRESS" ||
          jobData.TranscriptionJob?.TranscriptionJobStatus === "QUEUED"
        )
          return;
        clearInterval(refInterval);
        return resolve(jobData.TranscriptionJob);
      }, 5000);
    });
  }

  async launch(): Promise<void> {
    try {
      await this.askUserAudio();
      await this.askUserLanguageCode();
    } catch (err) {
      console.log("Bye!");
      process.exit();
    }
    await this.transcribe();
  }
}
