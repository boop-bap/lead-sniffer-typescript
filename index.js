import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import fastCsv from "fast-csv";
import multer from "multer";
import stream from "stream";
import cors from "cors";

dotenv.config();

const app = express();
const port = 3000;

app.use(cors());

// Initialize multer to handle file uploads in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10000000 }, // Limit file size to 1MB
  fileFilter: (req, file, cb) => {
    checkFileType(file, cb);
  },
}).single("file");

// Check file type
function checkFileType(file, cb) {
  const filetypes = /csv/; // Allowed file extension
  const extname = filetypes.test(file.originalname.toLowerCase());
  const mimetype =
    file.mimetype === "text/csv" ||
    file.mimetype === "application/vnd.ms-excel";

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb("Error: CSV Files Only!");
  }
}

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});

const options = {
  objectMode: true,
  delimiter: ",",
  quote: null,
  headers: true,
  renameHeaders: false,
};

const instructionsObject = JSON.parse(fs.readFileSync("instructions.json"));

const { headersToAdd, instructionsSettings, defaultSettings } =
  instructionsObject;

const getInstructions = () => {
  let test = `
1. Include the id provided in the answer with the title of 'Record ID' and display it only here once. 

2. Check if the website provided is online then display it with a title 'Alive' and the answer should be yes or no.

3. ${defaultSettings["Translation"]}

4. ${defaultSettings["Catalogs/leaflets"]}

5  ${defaultSettings["Business type"]}

6. ${defaultSettings["Business model"]}
`;

  return test;
};

// 1. If the webpage is not in english language then translate the questions to the website's language and search with them.

// 2. Include the id provided in the answer with the title of 'Record ID' and display it only here once.

// 3. Check if the website provided is online then display it with a title 'Alive' and the answer should be yes or no.

// 4. Check if the website has a somewhat monthly or more often updated catalog type. Display it with a title of 'Catalogs/leaflets' and the answer should be yes or no.

// 5. Check what type of a business it is, B2B(Business-to-Business), B2C(Business-to-Consumer), B2B and B2C, agency, if none apply then write none. Display it with a title of 'Business type' and use the provided types.

// 6. Check what is their business model on all of the pages on the website. Can be one or more of these types: retail, e-commerce, stores, both e-commerce and stores. Display it with a title of 'Business model' and use all relevant provided types and nothing else.

// 7. Do not display more information after all the checks.

// 8. Return the answer as a JSON a simple JSON object"

const runGPT = async (website, recordId) => {
  const chatCompletion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        name: "TestV1",
        content: process.env.CHATGPT_REQUEST_TEXT,
      },
      {
        role: "user",
        content: `Website URL: ${website} Record ID: ${recordId}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 1024,
    top_p: 0.1,
    frequency_penalty: 1,
    presence_penalty: 0.1,
    model: "gpt-4o-2024-05-13",
  });

  const answerResult = chatCompletion.choices[0].message.content
    .replace(/```json|```/g, "")
    .trim();
  const objectToReturn = JSON.parse(answerResult);

  return objectToReturn;
};

// Function to get data from CSV
const getDataFromCSV = (csvFilePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const readableStream = fs.createReadStream(csvFilePath);

    fastCsv
      .parseStream(readableStream, options)
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err));
  });
};

const getLeadDataFromGPT = async (csvData) => {
  const gptPromises = csvData.map((item) => {
    const url = item["Website URL"];
    const recordId = item["Record ID"];
    return runGPT(url, recordId);
  });

  const results = await Promise.all(gptPromises);

  return results;
};

const combineTwoDataArrays = (csvArray, gptArray) => {
  const combinedArray = [];

  csvArray.map((csvArrayItem) => {
    const tempObj = csvArrayItem;

    gptArray.map((leadItem) => {
      if (leadItem["Record ID"] == csvArrayItem["Record ID"]) {
        headersToAdd.forEach((columnName) => {
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

const createCSV = (data) => {
  const headers = Object.keys(data[0]);
  // Create the CSV string
  let csv = headers.join(",") + "\n";
  data.forEach((row) => {
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

  // Write the CSV string to a file
  // fs.writeFileSync(`test copy ${randomFileName}.csv`, csv);
};

// Function to get data from uploaded file
const getDataFromUploadedFile = (buffer) => {
  return new Promise((resolve, reject) => {
    const results = [];

    const bufferStream = new stream.PassThrough();
    const readableStream = bufferStream.end(buffer);

    fastCsv
      .parseStream(readableStream, options)
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err));
  });
};

app.get("/defaultInstructions", (req, res) => {
  console.log(123);
  res.send(process.env.CHATGPT_REQUEST_TEXT);
});

app.post("/upload", async (req, res) => {
  console.log(req.body);
  try {
    upload(req, res, async (err) => {
      if (req.file === undefined) {
        res.status(400).send("Error: No File Selected!");
      } else {
        const dataFromUploadedFile = await getDataFromUploadedFile(
          req.file.buffer
        );

        const chatGPTArray = await getLeadDataFromGPT(dataFromUploadedFile);

        const combinedArray = combineTwoDataArrays(
          dataFromUploadedFile,
          chatGPTArray
        );

        const csvToExport = createCSV(combinedArray);

        const randomFileName = crypto.randomUUID(0, 1000000);

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

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
