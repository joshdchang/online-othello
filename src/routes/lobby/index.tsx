import { component$ } from "@builder.io/qwik";
import {
  Form,
  routeAction$,
  routeLoader$,
  useNavigate,
  z,
  zod$,
} from "@builder.io/qwik-city";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { games, users } from "~/db/schema";
import * as schema from "~/db/schema";

export const boardInit =
  "0000000000000000000000000002100000012000000000000000000000000000";

export const useUser = routeLoader$(
  async ({ env, cookie, error, redirect }) => {
    const TURSO_URL = env.get("TURSO_URL");
    const TURSO_AUTH_TOKEN = env.get("TURSO_AUTH_TOKEN");

    if (!TURSO_URL || !TURSO_AUTH_TOKEN) {
      throw error(500, "Missing TURSO_URL or TURSO_AUTH_TOKEN");
    }
    const client = createClient({
      url: TURSO_URL,
      authToken: TURSO_AUTH_TOKEN,
    });
    const db = drizzle(client, { schema });

    const userId = cookie.get("userId");
    if (!userId) {
      throw redirect(302, "/");
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId.number()),
      with: {
        guestGames: true,
        hostGames: true,
      },
    });
    if (!user) {
      throw redirect(302, "/");
    }
    return user;
  },
);

export const useCreateGame = routeAction$(async (data, { env, cookie }) => {
  const TURSO_URL = env.get("TURSO_URL");
  const TURSO_AUTH_TOKEN = env.get("TURSO_AUTH_TOKEN");
  const userId = cookie.get("userId")?.number();
  if (!userId) {
    return {
      success: false,
      error: "Missing userId",
    };
  }

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
    const result = await db.insert(games).values({
      hostId: userId,
      board: boardInit,
      currentTurn: "1",
      player1: userId,
    });

    const gameId = result.lastInsertRowid;
    if (!gameId) {
      return {
        success: false,
        error: "Failed to create game",
      };
    }
    return {
      success: true,
      gameId,
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
});

export const useJoinGame = routeAction$(
  async (data, { env, cookie }) => {
    const { gameId } = data;

    const TURSO_URL = env.get("TURSO_URL");
    const TURSO_AUTH_TOKEN = env.get("TURSO_AUTH_TOKEN");
    const userId = cookie.get("userId")?.number();
    if (!userId) {
      return {
        success: false,
        error: "Missing userId",
      };
    }

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
      const result = await db
        .selectDistinct()
        .from(games)
        .where(eq(games.id, gameId));
      if (result.length !== 1) {
        return {
          success: false,
          error: "Game not found",
        };
      }
      if (!!result[0].guestId && result[0].guestId !== userId) {
        return {
          success: false,
          error: "This game is already full",
        };
      }
      if (result[0].hostId !== userId && result[0].guestId !== userId) {
        await db
          .update(games)
          .set({
            guestId: userId,
          })
          .where(eq(games.id, gameId));
      }
      return {
        success: true,
        gameId,
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
    gameId: z.coerce.number(),
  }),
);

export default component$(() => {
  const user = useUser();
  const createGame = useCreateGame();
  const joinGame = useJoinGame();
  const nav = useNavigate();
  return (
    <>
      <div class="flex h-screen flex-col items-center justify-center space-y-6">
        <h1 class="text-3xl font-bold">Welcome, {user.value.name}!</h1>
        <Form
          class="flex space-x-4 pt-10"
          action={joinGame}
          onSubmitCompleted$={(e) => {
            if (e.detail.value.success) {
              nav(`/game/${e.detail.value.gameId}`);
            }
          }}
        >
          <input
            type="number"
            name="gameId"
            class="w-28 rounded-md border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-600"
            placeholder="ID"
          />
          <button
            type="submit"
            class="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 active:bg-emerald-800"
          >
            Join
          </button>
        </Form>
        <div class="text-xl text-gray-500">or</div>
        <Form
          class="flex space-x-4"
          action={createGame}
          onSubmitCompleted$={(e) => {
            if (e.detail.value.success) {
              nav(`/game/${e.detail.value.gameId}`);
            }
          }}
        >
          <button
            type="submit"
            class="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 active:bg-emerald-800"
          >
            Create a new game
          </button>
        </Form>
      </div>
    </>
  );
});
