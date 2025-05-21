/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { yaml } from "@codemirror/lang-yaml";
import { useKeyBind } from "../hooks/keybind";
import { Map } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import YAML from "yaml";

export const FileEditor: React.FC = () => {
  const [content, setContent] = useState<string>("");
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [notification, setNotification] = useState<string>("");
  const [layersFiles, setLayersFiles] = useState<string[]>([]);
  const [currentFileName, setCurrentFileName] = useState<string>("style.yml");
  const [styleJsonOutput, setStyleJsonOutput] = useState<any | null>(null);

  const mapRef = useRef<maplibregl.Map | null>(null);

  useKeyBind({
    key: "s",
    ctrlKey: true,
    onKeyDown: () => saveFile(),
  });

  const initializeFromAssets = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}styles/default.json`);
      const json = await res.json();

      const { version, name, metadata, sources, sprite, glyphs, layers } = json;

      const styleYaml = {
        version,
        name: name ?? "Untitled",
        metadata,
        sources,
        sprite,
        glyphs,
        layers: layers.map((l: any) => `!!inc/file layers/${l.id}.yml`),
      };

      const styleYmlText = YAML.stringify(styleYaml);

      // OPFS 初期化・保存処理
      const rootDir = await navigator.storage.getDirectory();
      const styleFileHandle = await rootDir.getFileHandle("style.yml", { create: true });
      const writable = await styleFileHandle.createWritable();
      await writable.write(styleYmlText);
      await writable.close();
      setFileHandle(styleFileHandle);
      setContent(styleYmlText);

      const layersDir = await rootDir.getDirectoryHandle("layers", { create: true });
      for (const layer of layers) {
        const yamlText = YAML.stringify(layer);
        const fileHandle = await layersDir.getFileHandle(`${layer.id}.yml`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(yamlText);
        await writable.close();
      }

      const file = await styleFileHandle.getFile();
      const parsedText = await file.text();
      const parsedYaml = YAML.parse(parsedText);
      const files = (parsedYaml.layers ?? [])
        .filter((entry: any) => typeof entry === "string" && entry.includes("layers/"))
        .map((entry: string) => {
          const match = entry.match(/layers\/([\w\-.]+\.ya?ml)/);
          return match ? match[1] : null;
        })
        .filter((x: any): x is string => !!x);
      setLayersFiles(files);

      const resolvedJson = await resolveStyleYamlWithIncludes(styleFileHandle, rootDir);
      setStyleJsonOutput(resolvedJson);

      setNotification("assets/style.json を初期読み込みしました");
    } catch (e) {
      console.error("初期 style.json 読み込み失敗", e);
      setNotification("初期スタイルの読み込みに失敗しました");
    }
  };

  // 内容を保存する
  const saveFile = useCallback(async () => {
    if (!fileHandle) return;

    try {
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      setNotification("ファイルを保存しました");
    } catch (error) {
      console.error(error);
      setNotification("ファイルの保存に失敗しました");
    }

    try {
      const rootDirHandle = await navigator.storage.getDirectory();
      const styleFileHandle = await rootDirHandle.getFileHandle("style.yml");

      const resolvedJson = await resolveStyleYamlWithIncludes(styleFileHandle, rootDirHandle);
      setStyleJsonOutput(resolvedJson);
      setNotification("YAMLをJSONに変換しました");
    } catch (error) {
      console.error(error);
      setNotification("YAMLの変換に失敗しました");
    }
  }, [content, fileHandle]);

  // ファイルを選択して内容を読み込む
  const selectFile = async (fileName: string) => {
    try {
      // ルートディレクトリとlayersディレクトリの取得
      const rootDir = await navigator.storage.getDirectory();
      const fileHandle =
        fileName === "style.yml"
          ? await rootDir.getFileHandle("style.yml")
          : await (await rootDir.getDirectoryHandle("layers")).getFileHandle(fileName);

      // ファイル内容の読み込み
      const file = await fileHandle.getFile();
      const text = await file.text();
      setContent(text);
      setFileHandle(fileHandle);
      setCurrentFileName(fileName);
    } catch (error) {
      console.error(error);
      setNotification("ファイルの選択に失敗しました");
    }
  };

  const handleStyleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const json = JSON.parse(text);

    // 1. style.yml を作成（sources, sprite, glyphs など）
    const { version, name, metadata, sources, sprite, glyphs, layers } = json;
    const styleYaml: any = {
      version,
      name,
      metadata,
      sources,
      sprite,
      glyphs,
      layers: layers.map((l: any) => `!!inc/file layers/${l.id}.yml`),
    };

    const styleYmlText = YAML.stringify(styleYaml);
    setContent(styleYmlText);

    const rootDir = await navigator.storage.getDirectory();
    const styleFileHandle = await rootDir.getFileHandle("style.yml", { create: true });
    const writable = await styleFileHandle.createWritable();
    await writable.write(styleYmlText);
    await writable.close();
    setFileHandle(styleFileHandle);

    await saveLayersToOPFS(layers, rootDir);
    const resolvedJson = await resolveStyleYamlWithIncludes(styleFileHandle, rootDir);
    setStyleJsonOutput(resolvedJson);

    setNotification("style.json を読み込み YAML に変換しました");
  };

  const saveLayersToOPFS = async (layers: any[], rootDir: FileSystemDirectoryHandle) => {
    const layersDir = await rootDir.getDirectoryHandle("layers", { create: true });

    for (const layer of layers) {
      const layerYaml = YAML.stringify(layer);
      const fileHandle = await layersDir.getFileHandle(`${layer.id}.yml`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(layerYaml);
      await writable.close();
    }

    // 保存後のファイル一覧更新
    const files: string[] = [];
    for await (const [name, entry] of layersDir.entries()) {
      if (entry.kind === "file") files.push(name);
    }
    const ordered = await extractLayerOrderFromStyleYaml(rootDir);
    setLayersFiles(ordered);
  };

  const exportStyleJson = async () => {
    try {
      const rootDir = await navigator.storage.getDirectory();
      const styleFileHandle = await rootDir.getFileHandle("style.yml");
      const styleJson = await resolveStyleYamlWithIncludes(styleFileHandle, rootDir);

      const jsonText = JSON.stringify(styleJson, null, 2); // 整形して保存

      const blob = new Blob([jsonText], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "style.json";
      a.click();

      URL.revokeObjectURL(url);
      setNotification("style.json をエクスポートしました");
    } catch (error) {
      console.error(error);
      setNotification("style.json のエクスポートに失敗しました");
    }
  };

  const resolveStyleYamlWithIncludes = async (
    styleFileHandle: FileSystemFileHandle,
    rootDir: FileSystemDirectoryHandle
  ): Promise<any> => {
    const styleText = await (await styleFileHandle.getFile()).text();
    const styleYaml = YAML.parse(styleText);

    const resolvedLayers: any[] = [];

    for (const item of styleYaml.layers) {
      if (typeof item === "string" && item.startsWith("!!inc/file")) {
        const match = item.match(/!!inc\/file\s+(.+)/);
        if (match) {
          const path = match[1].trim(); // e.g., "layers/background.yml"
          const parts = path.split("/");
          const dir = await rootDir.getDirectoryHandle(parts[0]);
          const file = await (await dir.getFileHandle(parts[1])).getFile();
          const text = await file.text();
          const layerYaml = YAML.parse(text);

          // 単一のレイヤー or 複数レイヤー対応
          if (Array.isArray(layerYaml)) {
            resolvedLayers.push(...layerYaml);
          } else {
            resolvedLayers.push(layerYaml);
          }
        }
      } else if (typeof item === "object") {
        resolvedLayers.push(item);
      }
    }

    // スタイルオブジェクト再構成
    return {
      version: styleYaml.version,
      name: styleYaml.name ?? "Untitled",
      metadata: styleYaml.metadata,
      sources: styleYaml.sources,
      sprite: styleYaml.sprite,
      glyphs: styleYaml.glyphs,
      layers: resolvedLayers,
    };
  };

  const extractLayerOrderFromStyleYaml = async (rootDir: FileSystemDirectoryHandle): Promise<string[]> => {
    try {
      const styleFileHandle = await rootDir.getFileHandle("style.yml");
      const styleText = await (await styleFileHandle.getFile()).text();
      const styleObj = YAML.parse(styleText);

      const orderedFiles: string[] = [];

      for (const layerEntry of styleObj.layers ?? []) {
        if (typeof layerEntry === "string" && layerEntry.startsWith("!!inc/file")) {
          const match = layerEntry.match(/!!inc\/file\s+layers\/(.+\.yml)/);
          if (match) {
            orderedFiles.push(match[1]); // 例: "background.yml"
          }
        }
      }

      return orderedFiles;
    } catch (e) {
      console.error("レイヤー順の抽出に失敗しました", e);
      return [];
    }
  };

  const buttonStyle: React.CSSProperties = {
    padding: "8px 16px",
    backgroundColor: "#1976d2", // 深いブルー
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    fontWeight: "bold",
    fontSize: "14px",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.15)",
    transition: "background-color 0.3s",
  };

  // 初回レンダリング時にファイルシステムを初期化
  useEffect(() => {
    void initializeFromAssets();
  }, []);

  return (
    <>
      <div
        style={{
          display: "flex",
          height: "85vh",
          fontFamily: "sans-serif",
          padding: "12px",
          gap: "12px",
          boxSizing: "border-box",
        }}
      >
        {/* 左: ファイルリスト */}
        <div
          style={{
            width: "300px",
            backgroundColor: "#2b2b2b",
            color: "white",
            padding: "10px",
            borderRadius: "6px",
            boxShadow: "inset -1px 0 0 rgba(255,255,255,0.1)",
            overflowY: "auto",
          }}
        >
          <ul>
            <li
              onClick={() => selectFile("style.yml")}
              style={{
                cursor: "pointer",
                color: currentFileName === "style.yml" ? "lightblue" : "white",
                fontWeight: "bold",
              }}
            >
              style.yml
            </li>
            <li
              style={{
                cursor: "pointer",
                color: currentFileName !== "style.yml" ? "lightblue" : "white",
                marginLeft: "8px",
                fontWeight: "bold",
              }}
            >
              layers
            </li>
            <ul>
              {layersFiles.map((fileName) => (
                <li
                  key={fileName}
                  onClick={() => selectFile(fileName)}
                  style={{
                    cursor: "pointer",
                    color: currentFileName === fileName ? "lightblue" : "white",
                    marginLeft: "16px",
                  }}
                >
                  {fileName}
                </li>
              ))}
            </ul>
          </ul>
        </div>

        {/* 中央: エディタ */}
        <div
          style={{
            width: "560px",
            backgroundColor: "#1e1e1e",
            borderRadius: "6px",
            overflow: "hidden",
          }}
        >
          <CodeMirror
            value={content}
            theme={vscodeDark}
            extensions={[yaml()]}
            onChange={(value) => setContent(value)}
            height="90vh"
            width="600px"
            style={{ borderRadius: "6px" }}
          />
        </div>

        {/* 右: 地図 */}
        <div
          style={{
            flex: 1,
            borderRadius: "6px",
            overflow: "hidden",
            boxShadow: "0 0 0 1px #ccc inset",
          }}
        >
          {styleJsonOutput && (
            <Map
              mapLib={maplibregl}
              initialViewState={{
                longitude: 139.766966,
                latitude: 35.681163,
                zoom: 14,
              }}
              style={{ width: "100%", height: "100%" }}
              mapStyle={styleJsonOutput}
              ref={(ref) => {
                if (ref && !mapRef.current) {
                  const map = ref.getMap(); // MapLibreインスタンスを取得
                  mapRef.current = map;

                  map.on("error", (e) => {
                    console.error("MapLibre runtime error:", e.error);
                    alert("地図スタイルの適用中にエラーが発生しました。\n詳細は開発者ツールをご確認ください。");
                  });
                }
              }}
            />
          )}
        </div>
      </div>

      {/* 操作パネル */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          background: "#f4f4f4",
          borderTop: "1px solid #ccc",
          height: "5vh",
        }}
      >
        {/* Save + 通知 */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            style={buttonStyle}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#1565c0")}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#1976d2")}
            onClick={saveFile}
            disabled={!fileHandle}
          >
            Save (Ctrl + S)
          </button>
          <span style={{ color: "#666", fontSize: "0.9rem" }}>{notification}</span>
        </div>

        {/* 読み込み + エクスポート */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <input type="file" accept=".json" onChange={handleStyleJsonUpload} />
          <button
            style={buttonStyle}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#1565c0")}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#1976d2")}
            onClick={exportStyleJson}
          >
            style.json をエクスポート
          </button>
        </div>
      </div>
    </>
  );
};
