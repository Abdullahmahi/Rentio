import { useEffect, useMemo } from "react";
import { Camera, X } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Camera-first photo input with thumbnails and a remove button, for the
 * portal's report-payment and new-request forms. One thumb, 44px targets.
 * `capture="environment"` opens the phone's back camera directly.
 */
export function PhotoPicker({
  id,
  files,
  onChange,
  multiple = false,
}: {
  id: string;
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
}) {
  const { t } = useTranslation();
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const prompt =
    files.length === 0
      ? t("portal.takePhoto")
      : multiple
        ? t("portal.addAnotherPhoto")
        : (files[0]?.name ?? "");

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface text-sm text-muted-foreground"
      >
        <Camera className="size-6" />
        {prompt}
      </label>
      <input
        id={id}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={multiple}
        className="sr-only"
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])];
          onChange(multiple ? [...files, ...picked] : picked.slice(0, 1));
          // So picking the same file again still fires onChange.
          event.target.value = "";
        }}
      />
      {files.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.lastModified}-${index}`} className="relative">
              <img
                src={previews[index]}
                alt={file.name}
                className="aspect-square w-full rounded-lg border border-border object-cover"
              />
              <button
                type="button"
                aria-label={t("actions.remove")}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                className="absolute right-1 top-1 grid size-11 place-items-center rounded-full bg-background/90 text-foreground shadow"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
