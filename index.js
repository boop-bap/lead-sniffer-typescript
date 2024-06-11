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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const defaultInstructionsObj = JSON.parse(
  fs.readFileSync("json/defaultInstructions.json")
);
let userInstructionsObj = JSON.parse(
  fs.readFileSync("json/userInstructionsSave.json")
);

let { userInstructions } = userInstructionsObj;

const { headersToAdd, defaultInstructions } = defaultInstructionsObj;

const getInstructions = () => {
  const instructions = `

0. If the website is restricted with robots.txt skip the checks and write blocked with a title of "Alive". Nothing else if this is the case.

1. Include the id provided in the answer with the title of 'Record ID' and display it only here once. 

2. Check if the website provided is online then display it with a title 'Alive' and the answer should be yes or no.

3. ${userInstructions["Translation"]} Answer titles must stay english.

4. ${userInstructions["Catalogs/leaflets"]} Display it with a title of 'Catalogs/leaflets' and the answer should be yes or no and nothing else.

5  ${userInstructions["Business type"]} Display it with a title of 'Business type' and display the provided type, or multiple if there are multiple.

6. ${userInstructions["Business model"]} Display it with a title of 'Business model' and use all relevant provided types and nothing else.

7. Do not display more information after all the checks.

8. Return the answer as a JSON a simple JSON object.
`;

  return instructions;
};

const runGPT = async (website, recordId) => {
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

  console.log(objectToReturn);

  return objectToReturn;
};

// const test = async (website, recordId) => {
//   const chatCompletion = await openai.chat.completions.create({
//     messages: [
//       {
//         role: "system",
//         name: "TestV1",
//         content: `Search the web for news on recent AI developments and AI technologies.`,
//       },
//     ],
//     temperature: 0.2,
//     max_tokens: 1024,
//     top_p: 0.1,
//     frequency_penalty: 1,
//     presence_penalty: 0.1,
//     model: "gpt-4o-2024-05-13",
//   });

//   const answerResult = chatCompletion.choices[0].message.content;

//   console.log(answerResult);

//   return "asda";
// };

// test();

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

// Function to get data from an uploaded file
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

const updateUserInstructions = (req) => {
  const newUserInstructions = req.body;
  let textToModify = JSON.stringify(defaultInstructionsObj);

  for (let key in newUserInstructions) {
    let placeholder = new RegExp(`\\$\\{${key}\\}`, "g");
    textToModify = textToModify.replace(placeholder, newUserInstructions[key]);
  }

  fs.writeFileSync("json/userInstructionsSave.json", textToModify);

  userInstructionsObj = JSON.parse(
    fs.readFileSync("json/userInstructionsSave.json")
  );

  userInstructions = userInstructionsObj.userInstructions;
};

app.get("/defaultInstructions", (req, res) => {
  res.send(defaultInstructions);
  res.status(200);
});

app.get("/userSavedInstructions", (req, res) => {
  res.send(userInstructions);
  res.status(200);
});

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

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
