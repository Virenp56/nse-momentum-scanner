import fs from "fs/promises";
import path from "path";

const FILE_PATH = path.resolve(process.cwd(), "today.json");

const dateKey = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date()
  );

// Helper to create empty structure
function createEmptyDay(date = dateKey()) {
  return {
    date,
    scans: [],
    recommendations: {},
    archived: false,
  };
}

// Helper to read and parse the file safely
async function readDayFile() {
  try {
    const raw = await fs.readFile(FILE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      const initialDay = createEmptyDay();
      await writeDayFile(initialDay);
      return initialDay;
    }
    console.error("Error reading today.json:", err.message);
    return createEmptyDay();
  }
}

// Helper to atomically/safely write to file
async function writeDayFile(data) {
  try {
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
    return data;
  } catch (err) {
    console.error("Error writing today.json:", err.message);
    throw err;
  }
}

export async function getToday() {
  const todayDate = dateKey();
  let day = await readDayFile();

  // Reset file automatically if it holds data from a previous date
  if (!day || day.date !== todayDate) {
    day = createEmptyDay(todayDate);
    await writeDayFile(day);
  }

  return day;
}

export async function saveToday(data) {
  const todayDate = dateKey();
  const currentDay = await getToday();

  const updatedDay = {
    ...currentDay,
    date: todayDate,
    scans: data.scans || [],
    recommendations: data.recommendations || {},
  };

  return await writeDayFile(updatedDay);
}

export async function clearToday() {
  const todayDate = dateKey();
  const resetDay = createEmptyDay(todayDate);
  return await writeDayFile(resetDay);
}

export async function getDay(date) {
  const day = await readDayFile();
  return day.date === date ? day : null;
}

export async function getHistory() {
  return [];
}
