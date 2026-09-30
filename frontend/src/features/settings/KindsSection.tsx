import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useDeleteKind, useKinds, useUpdateKind } from "@/api/queries";
import type { KindUpdate, KindView } from "@/api/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { showError } from "@/lib/notify";
import { KindDialog } from "./KindDialog";

function Wording({
  label,
  words,
}: {
  label: KindView["parent_label"];
  words: [string, KindView["parent_label"] | undefined][];
}) {
  const gendered = [label.male, label.female].filter(Boolean).join(" / ");
  return (
    <div>
      <div>{label.neutral}</div>
      {gendered && <div className="text-xs text-stone-500">{gendered}</div>}
      {words.map(
        ([language, said]) =>
          said && (
            <div key={language} lang={language} className="text-xs text-stone-500">
              {language === "ms" ? "Melayu" : "Jawa"}: {said.neutral}
            </div>
          ),
      )}
    </div>
  );
}

/** Settings → Relationship kinds: the kinds of parent and child link on offer. */
export function KindsSection() {
  const kinds = useKinds();
  const update = useUpdateKind();
  const remove = useDeleteKind();
  const [editing, setEditing] = useState<KindView | "new" | null>(null);
  const [deleting, setDeleting] = useState<KindView | null>(null);

  function change(kind: KindView, body: KindUpdate, done: string) {
    update.mutate(
      { key: kind.key, body },
      { onSuccess: () => toast.success(done), onError: showError },
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-semibold">Relationship kinds</h2>
          <p className="max-w-2xl text-sm text-stone-500">
            The kinds of parent and child link you can choose from. Biological is built in and is
            the only one that counts as blood, for lineage and the relationship finder.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon />
          Add kind
        </Button>
      </div>

      {kinds.isError ? (
        <p className="text-sm text-red-600">{kinds.error.message}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>The parent is called</TableHead>
              <TableHead>The child is called</TableHead>
              <TableHead className="text-right">Links</TableHead>
              <TableHead>In the tree</TableHead>
              <TableHead>Offered</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(kinds.data ?? []).map((kind) => (
              <TableRow key={kind.key} className={kind.active ? undefined : "text-stone-400"}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {kind.label}
                    {kind.builtin && <Badge variant="secondary">Built in</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <Wording
                    label={kind.parent_label}
                    words={[
                      ["ms", kind.words?.ms?.parent_label],
                      ["jv", kind.words?.jv?.parent_label],
                    ]}
                  />
                </TableCell>
                <TableCell>
                  <Wording
                    label={kind.child_label}
                    words={[
                      ["ms", kind.words?.ms?.child_label],
                      ["jv", kind.words?.jv?.child_label],
                    ]}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">{kind.usage}</TableCell>
                <TableCell>
                  <Switch
                    checked={kind.in_layout}
                    disabled={kind.builtin}
                    aria-label={`Place ${kind.label.toLowerCase()} children under the parent`}
                    onCheckedChange={(in_layout) =>
                      change(
                        kind,
                        { in_layout },
                        in_layout
                          ? `${kind.label} children are placed under the parent.`
                          : `${kind.label} children are placed with their birth parents only.`,
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={kind.active}
                    disabled={kind.builtin}
                    aria-label={`Offer ${kind.label.toLowerCase()} when linking`}
                    onCheckedChange={(active) =>
                      change(
                        kind,
                        { active },
                        active
                          ? `${kind.label} is offered again.`
                          : `${kind.label} is hidden. Existing links keep it.`,
                      )
                    }
                  />
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {!kind.builtin && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(kind)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={kind.usage > 0}
                        title={kind.usage > 0 ? "In use: hide it instead" : undefined}
                        onClick={() => setDeleting(kind)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ul className="list-disc space-y-1 pl-5 text-xs text-stone-500">
        <li>
          <strong>In the tree</strong>: children linked this way are placed under this parent in the
          lineage layout. Off, they're placed with their birth parents only.
        </li>
        <li>
          <strong>Offered</strong>: a hidden kind stays on the links that use it, but isn't offered
          for new ones. A kind can only be deleted when no link uses it.
        </li>
      </ul>

      {editing && (
        <KindDialog kind={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              No link uses it, so nothing else changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.key, {
                  onSuccess: () => toast.success(`Deleted “${deleting.label}”.`),
                  onError: showError,
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
