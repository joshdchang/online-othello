import { component$ } from "@builder.io/qwik";
import {
  routeAction$,
  type DocumentHead,
  Form,
  zod$,
  z,
  useNavigate,
  type RequestHandler,
} from "@builder.io/qwik-city";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { users } from "~/db/schema";
import { eq } from "drizzle-orm";

export const useCreateUser = routeAction$(
  async (data, { env, cookie }) => {
    const { name } = data;

    const TURSO_URL = env.get("TURSO_URL");
    const TURSO_AUTH_TOKEN = env.get("TURSO_AUTH_TOKEN");

    if (!TURSO_URL || !TURSO_AUTH_TOKEN) {
      return {
        success: false,
        error: "Missing TURSO_URL or TURSO_AUTH_TOKEN",
      };
    }
    const client = createClient({
      url: TURSO_URL,
      authToken: TURSO_AUTH_TOKEN,
    });
    const db = drizzle(client);

    try {
      const result = await db.insert(users).values({ name });
      const userId = result.lastInsertRowid;
      if (!userId) {
        return {
          success: false,
          error: "Failed to create user",
        };
      }
      cookie.set("userId", Number(userId));
      return {
        success: true,
      };
    } catch (e) {
      if (e instanceof Error) {
        return {
          success: false,
          error: e.message,
        };
      }
      return {
        success: false,
        error: "Unknown error",
      };
    }
  },
  zod$({
    name: z.string(),
  }),
);

export const onRequest: RequestHandler = async ({ cookie, env, error, redirect }) => {
  const TURSO_URL = env.get("TURSO_URL");
  const TURSO_AUTH_TOKEN = env.get("TURSO_AUTH_TOKEN");

  if (!TURSO_URL || !TURSO_AUTH_TOKEN) {
    throw error(500, "Missing TURSO_URL or TURSO_AUTH_TOKEN");
  }
  const client = createClient({
    url: TURSO_URL,
    authToken: TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client);

  const userId = cookie.get("userId");
  if (userId) {
    const user = await db.select().from(users).where(eq(users.id, userId.number()));
    if (user.length) {
      throw redirect(302, "/lobby");
    }
  }
};

export default component$(() => {
  const createUser = useCreateUser();
  const nav = useNavigate();

  return (
    <>
      <div class="flex h-screen flex-col items-center justify-center space-y-10">
        <h1 class="text-3xl font-bold">Josh's Online Othello</h1>
        <Form
          class="flex space-x-4"
          action={createUser}
          onSubmitCompleted$={(e) => {
            if (e.detail.value.success) {
              nav("/lobby");
            }
          }}
        >
          <input
            type="text"
            name="name"
            class="rounded-md border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-600"
            placeholder="Enter your name"
          />
          <button
            type="submit"
            class="rounded-md bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 active:bg-emerald-800 font-medium"
          >
            Play
          </button>
        </Form>
        {!createUser.value?.success && createUser.value?.error && (
          <div class="text-red-500">{createUser.value.error}</div>
        )}
      </div>
    </>
  );
});

export const head: DocumentHead = {
  title: "Othello Online",
  meta: [
    {
      name: "description",
      content: "Play Othello with your friends online.",
    },
  ],
};
