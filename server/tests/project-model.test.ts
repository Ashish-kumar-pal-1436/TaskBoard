import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { ProjectModel } from "../src/features/projects/project.model.js";

describe("project persistence schema", () => {
  it("stores comments as card subdocuments and activity as project subdocuments", () => {
    const ownerId = new mongoose.Types.ObjectId();
    const projectId = new mongoose.Types.ObjectId();
    const columnId = new mongoose.Types.ObjectId();
    const commentId = new mongoose.Types.ObjectId();
    const project = new ProjectModel({
      name: "Schema check",
      ownerId,
      members: [{ userId: ownerId, role: "owner" }],
      columns: [{ name: "To Do", position: 0 }],
      cards: [
        {
          _id: new mongoose.Types.ObjectId(),
          columnId,
          title: "Persist comment",
          position: 0,
          comments: [
            {
              _id: commentId,
              authorId: ownerId,
              content: "Comment is embedded",
            },
          ],
        },
      ],
      activities: [
        {
          projectId,
          actorId: ownerId,
          action: "comment.added",
          entityId: commentId,
          metadata: { title: "Persist comment" },
          createdAt: new Date(),
        },
      ],
    });

    expect(project.validateSync()).toBeUndefined();
    const record = project.toObject();
    expect(record.cards[0].comments[0].content).toBe("Comment is embedded");
    expect(record.activities[0].projectId.toString()).toBe(projectId.toString());
  });
});
