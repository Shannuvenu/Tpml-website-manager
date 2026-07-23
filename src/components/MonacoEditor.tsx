import Editor from '@monaco-editor/react';
import type { OpenFile } from '../types/config';

interface MonacoEditorProps {
  openFile: OpenFile | null;
  onChange: (value: string) => void;
}

export default function MonacoEditor({ openFile, onChange }: MonacoEditorProps) {
  if (!openFile) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Select a file from the explorer to begin editing.
      </div>
    );
  }

  const isDirty = openFile.currentContent !== openFile.originalContent;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="h-9 flex items-center gap-2 px-3 border-b border-border bg-panelAlt shrink-0">
        <span className="text-[13px] font-mono text-text-primary truncate">{openFile.path}</span>
        {isDirty && (
          <span
            title="Unsaved changes"
            className="w-1.5 h-1.5 rounded-full bg-warning shrink-0"
          />
        )}
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={openFile.language}
          value={openFile.currentContent}
          theme="vs-dark"
          onChange={(value) => onChange(value ?? '')}
          options={{
            fontSize: 13,
            fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
            minimap: { enabled: true },
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            renderWhitespace: 'selection',
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}
