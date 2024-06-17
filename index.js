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
const PORT = process.env.PORT || 3000;
const allowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://boop-bap.github.io",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (origin === undefined) {
      callback(null, { origin: true, methods: ["GET"] });
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

// Load default instructions
const {
  defaultInstructions,
  userInstructions: userInstructionsToReplaceFromDefault,
} = JSON.parse(fs.readFileSync("json/defaultInstructions.json"));

// Load user instructions
let userInstructions = JSON.parse(
  fs.readFileSync("json/userInstructionsSave.json")
);

// These are final instructions will go to ChatGPT

const getInstructions = (type, instructions) => {
  const instructionsString = `
I need you to be very very sure(100%) with the answers without any speculation.

1. It is very important to include the id provided in the answer with the title of "Record ID" and display it only here once. 

2. Translate the parts of the instructions that tell you what to look for on the website language, but the titles and answers should stay English!

3. ${instructions} Display the answer with the title of "${type}".

4. I need you to be very very sure(100%) with the answers without any speculation.

5. Do not display more information after all the checks.

6. Return the answer as a clean and valid JSON object.`;

  return instructionsString;
};

const runGPT = async (website, recordId, type, instructions) => {
  const chatCompletion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        name: "TestV1",
        content: getInstructions(type, instructions),
      },
      {
        role: "user",
        content: `Website URL: ${website} Record ID: ${recordId}`,
      },
    ],
    temperature: 0.1, // Higher values means the model will take more risks.
    top_p: 0.1, // alternative to sampling with temperature, called nucleus sampling
    frequency_penalty: 0, // Number between -2.0 and 2.0. Positive values penalize new tokens more frequently
    presence_penalty: 0, // Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far
    model: "gpt-4o",
  });

  // The answer is in the form of a JSON object
  const answerResult = chatCompletion.choices[0].message.content
    .replace(/```json|```/g, "")
    .trim();

  console.log(answerResult);

  return JSON.parse(answerResult);
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

const getLeadDataFromGPT = async (csvData) => {
  const promises = csvData.map(async (item) => {
    const url = item["Website URL"];
    const recordId = item["Record ID"];

    return new Promise(async (resolve) => {
      const gptPromises = [];

      for (const type in userInstructions) {
        const answerPromise = runGPT(
          url,
          recordId,
          type,
          userInstructions[type]
        );

        gptPromises.push(answerPromise);
      }

      const gptResults = await Promise.all(gptPromises);

      resolve(gptResults);
    });
  });

  return await Promise.all(promises);
};

const combineTwoDataArrays = (csvArray, gptArray) => {
  const combinedArray = [];

  csvArray.forEach((csvArrayItem) => {
    const tempObj = csvArrayItem;

    gptArray.forEach((leadArrayItem) => {
      leadArrayItem.forEach((leadItem) => {
        if (leadItem["Record ID"] == csvArrayItem["Record ID"]) {
          for (const type in userInstructions) {
            if (!tempObj[type]) {
              tempObj[type] = leadItem[type];
            }
          }
        }
      });
    });

    combinedArray.push(tempObj);
  });

  return combinedArray;
};

const createCSV = (data) => {
  const headers = Object.keys(data[0]);
  // Create a CSV string
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

  // Write the CSV string to a file locally
  // fs.writeFileSync(`test copy ${randomFileName}.csv`, csv);
};

// Function to get data from a file that has been uploaded through a browser
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

// Takes default and inserts user instructions in to ${key}
const updateUserInstructions = (req) => {
  const newUserInstructions = req.body;

  let textToModify = JSON.stringify(userInstructionsToReplaceFromDefault);

  for (let key in newUserInstructions) {
    let placeholder = new RegExp(`\\$\\{${key}\\}`, "g");
    textToModify = textToModify.replace(placeholder, newUserInstructions[key]);
  }
  fs.writeFileSync("json/userInstructionsSave.json", textToModify);

  userInstructions = JSON.parse(
    fs.readFileSync("json/userInstructionsSave.json")
  );
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
  updateUserInstructions(req, res);
  res.status(200).send("Instructions updated successfully");
});

app.post("/upload", async (req, res) => {
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
        const randomFileName = crypto.randomUUID(0, 10000);

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
