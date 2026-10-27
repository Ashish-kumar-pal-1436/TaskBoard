import mongoose from "mongoose";
import { ProjectModel } from "../features/projects/project.model.js";
import { UserModel } from "../features/auth/user.model.js";

mongoose.set("bufferCommands", false);

export async function connectToDatabase(
  uri: string,
  onUnavailable: (error: Error) => void = (error) => {
    console.error("MongoDB connection lost:", error.name);
  },
): Promise<void> {
  mongoose.connection.on("disconnected", () => {
    console.error("MongoDB disconnected.");
  });
  mongoose.connection.on("error", onUnavailable);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await UserModel.init();
  await ProjectModel.init();
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
}
