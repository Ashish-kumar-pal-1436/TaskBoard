import { model, Schema, type InferSchemaType } from "mongoose";

const projectMembershipSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["owner", "member"],
      required: true,
    },
  },
  { _id: false },
);

const projectColumnSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 50,
  },
  position: {
    type: Number,
    required: true,
    min: 0,
  },
});

const projectCardSchema = new Schema(
  {
    columnId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
    },
    description: {
      type: String,
      default: "",
      maxlength: 2000,
    },
    assigneeId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    labels: {
      type: [String],
      default: [],
      validate: {
        validator: (labels: string[]) =>
          labels.length <= 8 && labels.every((label) => label.length <= 24),
        message: "Cards can have at most 8 labels of up to 24 characters each.",
      },
    },
    position: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true },
);

const projectSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: {
      type: [projectMembershipSchema],
      required: true,
      validate: {
        validator: (members: Array<{ userId: unknown; role: string }>) =>
          members.length > 0 &&
          members.filter((member) => member.role === "owner").length === 1,
        message: "A project must have exactly one owner membership.",
      },
    },
    columns: {
      type: [projectColumnSchema],
      required: true,
      default: [],
    },
    cards: {
      type: [projectCardSchema],
      required: true,
      default: [],
    },
  },
  { timestamps: true },
);

projectSchema.index({ "members.userId": 1 });

export type ProjectDocumentShape = InferSchemaType<typeof projectSchema>;

export const ProjectModel = model("Project", projectSchema);
