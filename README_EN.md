# 🤖 MechaBaby Workflow Tracer

**English** | [简体中文](./README.md)

An enhanced extension for ComfyUI designed to record, visualize, and extract the actual execution path within a workflow. It helps you "dehydrate" large, complex workflows to extract the truly functional logic segments.

---

## 🌟 Core Features

### 1. Real-time Path Visualization
- **Execution Highlighting**: Active nodes are highlighted in yellow, and completed nodes in green.
- **Glowing Links**: Automatically identifies and illuminates links that actually transmitted data, clearly showing the data flow.
- **Modern UI Compatible**: Fully supports ComfyUI's "Modern Node Design (Vue Nodes)".

### 2. Precise Execution Statistics
- **Execution Order**: Intuitively marks the execution sequence of each node.
- **Duration Measurement**: Accurately records the execution time of each node (in seconds).
- **Loop Support**: Supports looped nodes. Hover over the label to view all execution sequence numbers and cumulative duration for that node across multiple iterations.

### 3. Jump to Error Node
- **Panel Button**: Click "⚠️ Jump to Error Node" to quickly center the canvas on the last node that caused an execution error.
- **Right-click Menu**: Right-click on the canvas background and select "⚠️ Jump to Error Node" to jump. When an error record exists, the menu shows the node ID.
- Automatically records the error node on execution failure for quick troubleshooting in large workflows.

### 4. Intelligent Workflow Extraction (Export)
Two export modes are provided to help you quickly save execution results:
- **🛠️ Pure Path**: Saves ONLY the nodes actually executed in the current run. Ideal for analyzing logic.
- **🔗 Logic Integrity**: **Recommended Mode**. Not only retains executed nodes but also automatically traces back all necessary ancestor nodes (e.g., model loaders, global parameters).
  - **Virtual Link Support**: Deeply adapted for `easy-use` (setNode/getNode) and `Anywhere` nodes, ensuring "remote" dependency logic is preserved.
  - **Parameter Protection**: Automatically retains global parameter nodes like `GeneralInput`, ensuring the exported JSON can be loaded and run directly.

---

## 🚀 How to Use

1. **Panel Controls**:
   - Check **ON** to start tracing; uncheck to stop recording (no impact on performance).
   - The panel is **draggable** and will remember its position on the screen.
2. **Right-click Menu**:
   - Right-click on the canvas background to quickly toggle the tracer, show/hide the panel, clear records, or jump to the error node.
3. **View Loops**:
   - If a node is executed multiple times (looping), hover your mouse over the label above the node to expand the full execution list.

---

## 🛠️ Installation

1. Navigate to the ComfyUI custom nodes directory: `ComfyUI/custom_nodes/`
2. Clone this repository:
   ```bash
   git clone https://github.com/MechaBabyAi/ComfyUI-MechaBaby-WorkflowTracer.git
   ```
3. Restart ComfyUI.

---

## ⚖️ Performance

This extension is implemented by hooking the LiteGraph rendering layer and **only executes during render frames**. It does not interfere with the ComfyUI backend's Python execution logic, making its impact on image generation speed negligible.

---

## 📝 Changelog

### v0.2.0 (2025-02-01)
- **Added**: Jump to Error Node
  - Panel "Jump to Error Node" button
  - Right-click menu "Jump to Error Node" option with error node ID display
  - Auto-records error node on execution failure for quick troubleshooting in large workflows

---

## 🤝 Acknowledgments
Special thanks to all community users for their suggestions, particularly regarding large-model workflows and feedback on Logic Integrity exports.
