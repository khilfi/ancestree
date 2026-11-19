// @vitest-environment jsdom
/**
 * How two people are related, as the card says it, with answers from the test family
 * Keluarga Contoh as the Python engine gives them (src/kinship/golden/seed.json.gz). Since
 * 0.8.7: two relations that tie are both shown, and one said the same way by another
 * line says the other way round too.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { keys } from "@/api/queries";
import type { KinshipAnswer } from "@/api/types";
import { golden } from "@/kinship/golden";
import { RelationshipCard } from "./RelationshipCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const seed = golden("seed");
const named = (name: string) => {
  const person = seed.people.find((p) => p.nickname === name || p.full_name.startsWith(name));
  if (!person) throw new Error(`No ${name} in the test family`);
  return person.id;
};
const answerFor = (a: string, b: string): KinshipAnswer => {
  const found = seed.answers.find((answer) => answer.a === named(a) && answer.b === named(b));
  if (!found) throw new Error(`No answer for ${a} and ${b}`);
  return found;
};

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function show(answer: KinshipAnswer): HTMLElement {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(keys.kinshipSettings, { language: "en", titles: [], youngest: "su" });
  const noop = () => {};
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <RelationshipCard
          answer={answer}
          error={null}
          shown={0}
          onShow={noop}
          onSwap={noop}
          onPickAnother={noop}
          onDone={noop}
        />
      ),
    },
  ]);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
  return container;
}

describe("the relationship card", () => {
  it("shows both of two relations that tie, the same both ways round", () => {
    // The review's #12: before, "Rokiah is Acan's sister-in-law" one way and "Acan is Rokiah's
    // co-parent-in-law" the other, each hiding the other.
    const there = show(answerFor("Acan", "Rokiah")).textContent ?? "";
    expect(there).toContain("Also related as…");
    expect(there).toContain("Rokiah is Acan's sister-in-law");
    expect(there).toContain("Rokiah is Acan's co-parent-in-law");
    act(() => root?.unmount());

    const back = show(answerFor("Rokiah", "Acan")).textContent ?? "";
    expect(back).toContain("Acan is Rokiah's brother-in-law");
    expect(back).toContain("Acan is Rokiah's co-parent-in-law");
  });

  it("says the other way round for a relation said the same way by another line", () => {
    // Irfan's parents are cousins: he is Tok Ismail's great-grandson twice over.
    const card = show(answerFor("Tok Ismail", "Irfan"));
    const text = card.textContent ?? "";
    expect(text.match(/Irfan is Tok Ismail's great-grandson/g)).toHaveLength(2);
    const also = card.querySelector("li")?.textContent ?? "";
    expect(also).toMatch(
      /The other way round: Tok Ismail is Irfan's (paternal|maternal) great-grandfather/,
    );
    expect(text).toContain("Tok Ismail is Irfan's paternal great-grandfather");
    expect(text).toContain("Tok Ismail is Irfan's maternal great-grandfather");
  });
});
