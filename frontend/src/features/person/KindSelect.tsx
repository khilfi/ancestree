import { useKinds } from "@/api/queries";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Biological, adoptive, foster… the kinds shown in Settings, hidden ones left out. */
export function KindSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const kinds = useKinds();
  const options = (kinds.data ?? []).filter((kind) => kind.active || kind.key === value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Kind" />
      </SelectTrigger>
      <SelectContent>
        {options.map((kind) => (
          <SelectItem key={kind.key} value={kind.key}>
            {kind.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
