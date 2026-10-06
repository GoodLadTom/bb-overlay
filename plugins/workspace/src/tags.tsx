// Tags: the member's own labels, shown as chips beside the harness filter. Click a
// chip to filter the rail; right-click it to rename, recolour or delete;
// "+ Tag" creates one. Rows show their tags as small swatches.
import { useEffect, useRef, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { tnum } from "./shared";
import { Menu, MenuItem, MenuSeparator, MenuSub } from "./menu";
import { TAG_COLORS, TAG_CSS, type RailOps, type Tag, type TagColor } from "./rail-state";

export function TagSwatches({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-[3px]" title={tags.map((t) => t.name).join(", ")}>
      {tags.slice(0, 3).map((t) => (
        <span key={t.id} aria-hidden className="inline-block size-[7px] rounded-[2px]" style={{ background: TAG_CSS[t.color] }} />
      ))}
      {tags.length > 3 ? <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span> : null}
    </span>
  );
}

export function TagInput({ onSubmit, onCancel, placeholder = "New tag" }: { onSubmit: (name: string, color: TagColor) => void; onCancel: () => void; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState<TagColor>("gold");
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--attention)] bg-background pl-2 pr-1">
      <button
        type="button"
        aria-label="Change colour"
        title="Change colour"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setColor((c) => TAG_COLORS[(TAG_COLORS.indexOf(c) + 1) % TAG_COLORS.length])}
        className="size-3 shrink-0 rounded-[3px]"
        style={{ background: TAG_CSS[color] }}
      />
      <input
        ref={ref}
        placeholder={placeholder}
        maxLength={32}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = e.currentTarget.value.trim();
            if (v) onSubmit(v, color);
            else onCancel();
          } else if (e.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
        className="h-6 w-24 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export function TagFilter({
  ops,
  counts,
  value,
  onChange,
  creating,
  setCreating,
  onCreated,
}: {
  ops: RailOps;
  counts: Map<string, number>;
  value: string | null;
  onChange: (tagId: string | null) => void;
  creating: boolean;
  setCreating: (v: boolean) => void;
  onCreated?: (tag: Tag) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const tags = ops.state.tags;
  return (
    <div className="mx-1 mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
      {tags.map((t) =>
        renaming === t.id ? (
          <TagInput
            key={t.id}
            placeholder={t.name}
            onCancel={() => setRenaming(null)}
            onSubmit={(name, color) => {
              setRenaming(null);
              void ops.updateTag(t.id, { name, color });
            }}
          />
        ) : (
          <Menu
            key={t.id}
            trigger={
              <button
                type="button"
                aria-pressed={value === t.id}
                onClick={() => onChange(value === t.id ? null : t.id)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors data-[state=open]:bg-accent",
                  value === t.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <span aria-hidden className="inline-block size-2 rounded-[2px]" style={{ background: TAG_CSS[t.color] }} />
                {t.name}
                <span className="opacity-60" style={tnum}>{counts.get(t.id) ?? 0}</span>
              </button>
            }
          >
            <MenuItem icon="Edit" label="Rename" onSelect={() => setRenaming(t.id)} />
            <MenuSub icon="Settings" label="Colour">
              {TAG_COLORS.map((c) => (
                <MenuItem key={c} swatch={TAG_CSS[c]} label={c.charAt(0).toUpperCase() + c.slice(1)} checked={t.color === c} onSelect={() => void ops.updateTag(t.id, { color: c })} />
              ))}
            </MenuSub>
            <MenuSeparator />
            <MenuItem icon="Trash2" label="Delete tag" hint="chats stay" danger onSelect={() => { if (value === t.id) onChange(null); void ops.deleteTag(t.id); }} />
          </Menu>
        ),
      )}
      {creating ? (
        <TagInput
          onCancel={() => setCreating(false)}
          onSubmit={(name, color) => {
            setCreating(false);
            ops.createTag(name, color).then(
              (tag) => onCreated?.(tag),
              (e) => toast.error("Could not create tag", { description: e instanceof Error ? e.message : String(e) }),
            );
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-[12px] text-muted-foreground hover:border-foreground hover:text-foreground"
        >
          <Icon name="Plus" className="size-3" />
          Tag
        </button>
      )}
    </div>
  );
}
