import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import multer from "multer";
import stream from "stream";
import cors, { CorsOptions } from "cors";

import * as fastCsv from "fast-csv";
import { CsvDataItem } from "interfaces";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;
const allowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://boop-bap.github.io",
];

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (origin === undefined) {
      callback(null, false);
    } else if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`Origin not allowed by CORS: ${origin}`);
      callback(new Error(`Origin not allowed by CORS: ${origin}`), false);
    }
  },
  methods: "GET, POST", // Specify allowed methods globally
  allowedHeaders: "Content-Type, Authorization",
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const options = {
  objectMode: true,
  delimiter: ",",
  quote: null,
  headers: true,
  renameHeaders: false,
};

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});

// Initialize multer to handle file uploads in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10000000 }, // Limit file size to 10MB
  fileFilter: (req, file, cb) => {
    checkFileType(file, cb);
  },
}).single("file");

// Check file type
function checkFileType(
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  const filetypes = /csv/; // Allowed file extension
  const extname = filetypes.test(file.originalname.toLowerCase());
  const mimetype =
    file.mimetype === "text/csv" ||
    file.mimetype === "application/vnd.ms-excel";

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    const err = new Error("Error: CSV Files Only!");
    return cb(err);
  }
}

// Load default instructions
const defaultInstructionsObj = JSON.parse(
  fs.readFileSync("json/defaultInstructions.json").toString()
);

// Load user instructions
let userInstructionsObj = JSON.parse(
  fs.readFileSync("json/userInstructionsSave.json").toString()
);

let { userInstructions } = userInstructionsObj;
const { headersToAdd, defaultInstructions } = defaultInstructionsObj;

// These are final instructions will go to ChatGPT
const getInstructions = () => {
  const instructions = `

  I need you to be very very sure(100%) with the answers without any speculation.

0. If the website is restricted with robots.txt skip the checks and write blocked with a title of "Alive". No other checks should be performed if this is the case.

1. Include the id provided in the answer with the title of "Record ID" and display it only here once. 

2. Check if the website provided is online then display it with a title "Alive" and the answer should be yes or no. If No skip the checks.

3. ${userInstructions["Translation"]} Answer titles must stay English.

4. ${userInstructions["Catalogs/leaflets"]} Display the answer with the title "Catalogs/leaflets" there should only be one answer Yes or No and nothing else.

5  ${userInstructions["Business type"]} Please display the type found with the title "Business type". Multiple business types may apply and nothing else.

6. ${userInstructions["Business model"]} Display it with the title "Business model". Multiple types may apply and nothing else.

7. I need you to be very very sure(100%) with the answers without any speculation.

8. Do not display more information after all the checks.

9. Return the answer as a simple JSON object.
`;

  return instructions;
};

const runGPT = async (website: string, recordId: string) => {
  const chatCompletion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        name: "TestV1",
        content: getInstructions(),
      },
      {
        role: "user",
        content: `Website URL: ${website} Record ID: ${recordId}`,
      },
    ],
    temperature: 0.2, // Higher values means the model will take more risks.
    max_tokens: 1024, // The maximum number of tokens to generate in the completion.
    top_p: 0.1, // alternative to sampling with temperature, called nucleus sampling
    frequency_penalty: 1, // Number between -2.0 and 2.0. Positive values penalize new tokens more frequently
    presence_penalty: 0.1, // Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far
    model: "gpt-4o-2024-05-13",
  });

  // The answer is in the form of a JSON object
  const answerResult = chatCompletion?.choices?.[0].message.content as string;

  const finalAnswer = answerResult.replace(/```json|```/g, "").trim();

  const objectToReturn = JSON.parse(finalAnswer);
  return objectToReturn;
};

// Function to get data from a local CSV file using fastCsv
// const getDataFromCSV = (csvFilePath) => {
//   return new Promise((resolve, reject) => {
//     const results = [];
//     const readableStream = fs.createReadStream(csvFilePath);

//     fastCsv
//       .parseStream(readableStream, options)
//       .on("data", (data) => results.push(data))
//       .on("end", () => resolve(results))
//       .on("error", (err) => reject(err));
//   });
// };

// Used to run GPT on each website URL in the CSV
const getLeadDataFromGPT = async (csvData: CsvDataItem[]) => {
  const gptPromises = csvData.map((item: CsvDataItem) => {
    const url = item["Website URL"];
    const recordId = item["Record ID"];
    return runGPT(url, recordId);
  });

  const results = await Promise.all(gptPromises);

  return results;
};

const combineTwoDataArrays = (
  csvArray: CsvDataItem[],
  gptArray: CsvDataItem[]
) => {
  const combinedArray = [] as CsvDataItem[];

  csvArray.map((csvArrayItem: CsvDataItem) => {
    const tempObj = csvArrayItem;

    gptArray.map((leadItem: CsvDataItem) => {
      if (leadItem["Record ID"] == csvArrayItem["Record ID"]) {
        headersToAdd.forEach((columnName: string) => {
          if (!tempObj[columnName]) {
            tempObj[columnName] = leadItem[columnName];
          }
        });
      }
    });

    combinedArray.push(tempObj);
  });

  return combinedArray;
};

const createCSV = (data: CsvDataItem[]) => {
  const headers = Object.keys(data[0]);
  // Create a CSV string
  let csv = headers.join(",") + "\n";
  data.forEach((row: any) => {
    let values = headers.map((header) => {
      let value = row[header];
      // Escape double quotes by doubling them and wrap values in double quotes
      if (typeof value === "string") {
        value = value.replace(/"/g, '""');
      }
      return `"${value}"`;
    });
    csv += values.join(",") + "\n";
  });

  return csv;

  // Write the CSV string to a file locally
  // fs.writeFileSync(`test copy ${randomFileName}.csv`, csv);
};

// Function to get data from a file that has been uploaded through a browser
const getDataFromUploadedFile = (buffer: Buffer) => {
  return new Promise((resolve, reject) => {
    const results = [] as CsvDataItem[];

    const bufferStream = new stream.PassThrough();
    const readableStream = bufferStream.end(buffer);

    fastCsv
      .parseStream(readableStream, options)
      .on("data", (data: CsvDataItem) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", (err: Error) => reject(err));
  });
};

// Takes default and inserts user instructions in to ${key}
const updateUserInstructions = (req: any) => {
  const newUserInstructions = req.body;

  let textToModify = JSON.stringify(defaultInstructionsObj);

  for (let key in newUserInstructions) {
    let placeholder = new RegExp(`\\$\\{${key}\\}`, "g");
    textToModify = textToModify.replace(placeholder, newUserInstructions[key]);
  }
  fs.writeFileSync("json/userInstructionsSave.json", textToModify);

  userInstructionsObj = JSON.parse(
    fs.readFileSync("json/userInstructionsSave.json").toString()
  );

  userInstructions = userInstructionsObj.userInstructions;
};

//GET REQUESTS ---------------------------
app.get("/", (req, res) => {
  res.send("Hello World!");
  res.status(200);
});

app.get("/defaultInstructions", (req, res) => {
  res.send(defaultInstructions);
  res.status(200);
});

app.get("/userSavedInstructions", (req, res) => {
  res.send(userInstructions);
  res.status(200);
});

//POST REQUESTS ---------------------------
app.post("/updateUserInstructions", (req, res) => {
  updateUserInstructions(req);
  res.status(200).send("Instructions updated successfully");
});

app.post("/upload", async (req, res) => {
  try {
    upload(req, res, async (err) => {
      if (req.file === undefined) {
        res.status(400).send("Error: No File Selected!");
      } else {
        const dataFromUploadedFile = (await getDataFromUploadedFile(
          req.file.buffer
        )) as CsvDataItem[];

        const chatGPTArray: CsvDataItem[] = await getLeadDataFromGPT(
          dataFromUploadedFile
        );

        const combinedArray = combineTwoDataArrays(
          dataFromUploadedFile,
          chatGPTArray
        );

        const csvToExport = createCSV(combinedArray);

        const randomFileName: string = crypto.randomUUID();

        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${randomFileName}"`
        );
        res.setHeader("Content-Type", "text/csv");
        res.status(200).send(csvToExport);
      }
    });
  } catch (err) {
    res.status(500).send(err);
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port- ${PORT}`);
});
