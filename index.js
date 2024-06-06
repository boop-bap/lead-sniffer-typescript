require("dotenv").config();
const OpenAI = require("openai");
const fs = require("fs");
const fastCsv = require("fast-csv");

const options = {
  objectMode: true,
  delimiter: ",",
  quote: null,
  headers: true,
  renameHeaders: false,
};

answerTypes = [
  "Record ID",
  "Alive",
  "Catalogs/leaflets",
  "Business type",
  "Business model",
];

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});

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
        content: `${website} ${recordId}`,
      },
    ],
    model: "gpt-4o-2024-05-13",
  });

  const answerResult = chatCompletion.choices[0].message.content;
  return answerResult;
};

const findAnswer = (start, end, text) => {
  // Find the index of the start substring
  const startIndex = text.indexOf(start);

  if (startIndex !== -1) {
    // Find the index of the end substring
    const getEndIndex = text.indexOf(end, startIndex + start.length);
    const endIndex = getEndIndex >= 0 ? getEndIndex : text.length;

    if (endIndex !== -1) {
      // Extract the text between the start and end substrings
      return (result = text
        .substring(startIndex + start.length, endIndex)
        .replaceAll(":", "")
        .replaceAll("*", "")
        .replaceAll("+", "")
        .replace(/\n/g, "")
        .trim());
    } else {
      console.log("End substring not found");
      return "";
    }
  } else {
    console.log(start, "start");

    return "";
  }
};

const string = `Record ID: 91587957
Alive: Yes

Catalogs/leaflets: Yes

Business type: B2B

Business model: retail text`;

const getDataFromCSV = async (csvFilePath) => {
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
  console.log(results, "results");

  const leadObjectsArray = results.map((result) => {
    tempObj = {};

    answerTypes.forEach((category, index) => {
      const answer = findAnswer(category, answerTypes[index + 1], result);
      tempObj[category] = answer;
    });

    return tempObj;
  });

  return leadObjectsArray;
};

const combineTwoDataArrays = (csvArray, gptArray) => {
  const combinedArray = [];

  csvArray.map((csvArrayItem) => {
    const tempObj = csvArrayItem;

    // console.log(csvArrayItem["Record ID"], "csvArrayItem id match");
    gptArray.map((leadItem) => {
      //   console.log(leadItem["Record ID"], "leadItem id match");
      if (leadItem["Record ID"] == csvArrayItem["Record ID"]) {
        answerTypes.forEach((columnName) => {
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

const main = async (filePath) => {
  const dataArrayFromCSV = await getDataFromCSV(filePath);
  const chatGPTArray = await getLeadDataFromGPT(dataArrayFromCSV);
  const combinedArray = combineTwoDataArrays(dataArrayFromCSV, chatGPTArray);
  console.log(combinedArray);
  const headers = Object.keys(combinedArray[0]);
  // Create the CSV string
  let csv = headers.join(",") + "\n";
  combinedArray.forEach((row) => {
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
  const randomFileName = crypto.randomUUID(0, 1000000);
  // Write the CSV string to a file
  fs.writeFileSync(`test copy ${randomFileName}.csv`, csv);
};

main("30.csv");
