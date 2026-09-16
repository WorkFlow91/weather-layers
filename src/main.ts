import OBR from "@owlbear-rodeo/sdk";
import "./style.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main>
    <h1>Weather Layers</h1>
    <p id="status">Connecting to Owlbear Rodeo...</p>
  </main>
`;

OBR.onReady(() => {
  const status = document.querySelector("#status");

  if (status) {
    status.textContent = "Connected to Owlbear Rodeo ✓";
  }
});
