import { useRef } from "react";
import type { ChangeEvent } from "react";
import { importGpxFile, type GpxImportResult } from "../../gpx/importGpx.ts";
import { saveRoute } from "../../storage/routesRepository.ts";

export interface ImportGpxButtonProps {
  onImported: (result: GpxImportResult) => void;
  onError: (error: unknown) => void;
}

export function ImportGpxButton({ onImported, onError }: ImportGpxButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    importGpxFile(file)
      .then(async (result) => {
        await saveRoute(result.route);
        onImported(result);
      })
      .catch((error: unknown) => {
        onError(error);
      });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        Import GPX
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".gpx"
        aria-label="Import GPX file"
        style={{ display: "none" }}
        onChange={handleChange}
      />
    </div>
  );
}
