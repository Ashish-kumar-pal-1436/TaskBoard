import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        error: {
          code: "UNAUTHENTICATED",
          message: "Sign in to continue.",
        },
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

describe("authentication routes", () => {
  it("redirects unauthenticated visitors to the login page", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Sign in to Taskboard" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("shows registration and validates input before calling the API", async () => {
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeVisible();
    expect(screen.getByText("Use at least 12 characters for your password.")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("loads persisted project columns instead of a hardcoded board preview", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/auth/me") {
        return new Response(
          JSON.stringify({
            user: {
              id: "0123456789abcdef01234567",
              email: "owner@example.com",
              displayName: "Project Owner",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path === "/api/projects") {
        return new Response(
          JSON.stringify({
            projects: [
              {
                id: "abcdef0123456789abcdef01",
                name: "API project",
                role: "owner",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path === "/api/projects/abcdef0123456789abcdef01/columns") {
        return new Response(
          JSON.stringify({
            columns: [
              { id: "100000000000000000000001", name: "Draft", position: 0 },
              { id: "100000000000000000000002", name: "Review", position: 1 },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path === "/api/projects/abcdef0123456789abcdef01/activity") {
        return new Response(
          JSON.stringify({
            activities: [
              {
                id: "300000000000000000000001",
                projectId: "abcdef0123456789abcdef01",
                actorId: "0123456789abcdef01234567",
                actorName: "Project Owner",
                action: "card.created",
                entityId: "200000000000000000000001",
                metadata: { title: "Persisted task", toColumn: "Draft" },
                createdAt: "2026-10-28T00:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/cards/200000000000000000000001/comments")) {
        const method = fetchMock.mock.calls.at(-1)?.[1]?.method;
        const comments =
          method === "POST"
            ? [
                {
                  id: "400000000000000000000001",
                  authorId: "0123456789abcdef01234567",
                  authorName: "Project Owner",
                  content: "Looks good",
                  createdAt: "2026-10-28T00:00:00.000Z",
                },
              ]
            : [];
        return new Response(
          JSON.stringify({ comments }),
          {
            status: method === "POST" ? 201 : 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (
        path === "/api/projects/abcdef0123456789abcdef01/cards" &&
        fetchMock.mock.calls.at(-1)?.[1]?.method !== "POST"
      ) {
        return new Response(
          JSON.stringify({
            cards: [
              {
                id: "200000000000000000000001",
                columnId: "100000000000000000000001",
                title: "Persisted task",
                description: "Loaded from the API",
                assigneeId: null,
                dueDate: null,
                labels: ["API"],
                position: 1,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path === "/api/projects/abcdef0123456789abcdef01/cards" && fetchMock.mock.calls.at(-1)?.[1]?.method === "POST") {
        const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)) as {
          columnId: string;
          title: string;
          description: string;
          assigneeId: string | null;
          dueDate: string | null;
          labels: string[];
        };
        return new Response(
          JSON.stringify({
            cards: [
              {
                id: "200000000000000000000001",
                columnId: "100000000000000000000001",
                title: "Persisted task",
                description: "Loaded from the API",
                assigneeId: null,
                dueDate: null,
                labels: ["API"],
                position: 1,
              },
              { id: "200000000000000000000002", ...body, position: 2 },
            ],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "API project" })).toBeVisible();
    expect(await screen.findByRole("region", { name: "Draft column" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Review column" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Persisted task" })).toBeVisible();
    expect(screen.getAllByText("Loaded from the API")[0]).toBeVisible();
    expect(screen.getByText("API")).toBeVisible();
    const timeline = screen.getByRole("region", { name: "Project activity" });
    const activityItem = await within(timeline).findByRole("listitem");
    expect(within(activityItem).getByText("Project Owner")).toBeVisible();
    expect(
      within(activityItem).getByText(/created Persisted task in Draft/),
    ).toBeVisible();
    expect(screen.queryByText("Map the first-run experience")).not.toBeInTheDocument();

    const card = screen.getByRole("article");
    fireEvent.click(within(card).getByRole("button", { name: "Comments" }));
    expect(await screen.findByText("No comments yet.")).toBeVisible();
    fireEvent.change(within(card).getByLabelText("Write a comment"), {
      target: { value: "Looks good" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Add comment" }));
    expect(await screen.findByText("Looks good")).toBeVisible();
    expect(screen.getByText(/Project Owner ·/)).toBeVisible();

    fireEvent.click(
      within(screen.getByRole("region", { name: "Draft column" })).getByRole(
        "button",
        { name: "+ Add card" },
      ),
    );
    const form = screen.getByRole("form", { name: "Create card in Draft" });
    fireEvent.change(within(form).getByLabelText("Title"), {
      target: { value: "New card" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Create card" }));

    expect(await screen.findByRole("heading", { name: "New card" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/abcdef0123456789abcdef01/cards",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
