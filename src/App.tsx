import "./App.css";
import { FileEditor } from "./components/FileEditor";

function App() {
  return (
    <>
      <div>
        <h1
          style={{
            padding: "5px",
          }}
        >
          maplibre-style-editor
        </h1>
        <FileEditor />
      </div>
    </>
  );
}

export default App;
