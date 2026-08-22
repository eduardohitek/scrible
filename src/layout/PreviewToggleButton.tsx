import { useLayoutStore } from "./layoutStore";

export function PreviewToggleButton() {
  const previewVisible = useLayoutStore((state) => state.previewVisible);
  const togglePreview = useLayoutStore((state) => state.togglePreview);

  return (
    <div className="preview-toggle-container">
      <button
        type="button"
        className="preview-toggle"
        aria-pressed={previewVisible}
        onClick={() => void togglePreview()}
      >
        {previewVisible ? "Ocultar preview" : "Mostrar preview"}
      </button>
    </div>
  );
}
