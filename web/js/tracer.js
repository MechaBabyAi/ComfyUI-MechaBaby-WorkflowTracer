import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

/**
 * ComfyUI-MechaBaby-WorkflowTracer
 * 功能：
 * 1. 修复大工作流导出逻辑，确保 100% 成功率
 * 2. 递归回溯逻辑完整性，确保导出流可直接运行
 * 3. 兼容现代节点 (Vue) 与经典节点的高亮显示
 */

const executionState = {
    enabled: localStorage.getItem("mecha_tracer_enabled") !== "false",
    panelVisible: localStorage.getItem("mecha_tracer_panel_visible") !== "false",
    running: false,
    nodes: new Map(), 
    orderCounter: 0,
    executedNodes: new Set(),
    lastNodeId: null
};

app.registerExtension({
    name: "MechaBaby.WorkflowTracer",
    
    async setup() {
        api.addEventListener("execution_start", () => {
            if (!executionState.enabled) return;
            executionState.nodes.clear();
            executionState.orderCounter = 0;
            executionState.executedNodes.clear();
            executionState.running = true;
            executionState.lastNodeId = null;
            app.canvas.draw(true, true);
        });

        api.addEventListener("executing", ({ detail }) => {
            if (!executionState.enabled) return;
            const nodeId = detail;
            if (!nodeId) {
                executionState.running = false;
                this.finalizeNodeTiming(executionState.lastNodeId);
                app.canvas.draw(true, true);
                return;
            }

            if (executionState.lastNodeId && executionState.lastNodeId !== nodeId) {
                this.finalizeNodeTiming(executionState.lastNodeId);
            }

            executionState.orderCounter++;
            let nodeRecords = executionState.nodes.get(nodeId);
            if (!nodeRecords) {
                nodeRecords = [];
                executionState.nodes.set(nodeId, nodeRecords);
            }
            
            nodeRecords.push({
                order: executionState.orderCounter,
                startTime: performance.now(),
                endTime: null,
                duration: 0
            });
            
            executionState.executedNodes.add(nodeId);
            executionState.lastNodeId = nodeId;
            app.canvas.draw(true, true);
        });

        api.addEventListener("executed", ({ detail }) => {
            if (!executionState.enabled) return;
            this.finalizeNodeTiming(detail.node);
            app.canvas.draw(true, true);
        });

        const origDrawNode = LGraphCanvas.prototype.drawNode;
        LGraphCanvas.prototype.drawNode = function(node, ctx) {
            origDrawNode.apply(this, arguments);
            if (!executionState.enabled) return;
            const records = executionState.nodes.get(String(node.id));
            if (!records || records.length === 0) return;

            ctx.save();
            const titleHeight = LiteGraph.NODE_TITLE_HEIGHT || 20;
            const isCurrent = executionState.lastNodeId === String(node.id) && executionState.running;
            const isMouseOver = app.canvas.node_over === node;

            ctx.strokeStyle = isCurrent ? "#FFFF00" : "#00FF00";
            ctx.lineWidth = isCurrent ? 5 : 3;
            ctx.shadowBlur = isCurrent ? 20 : 10;
            ctx.shadowColor = isCurrent ? "#FFFF00" : "#00FF00";
            const margin = 3;
            ctx.strokeRect(-margin, -titleHeight - margin, node.size[0] + margin * 2, node.size[1] + titleHeight + margin * 2);

            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            
            let totalDuration = 0;
            records.forEach((r, idx) => {
                if (r.duration > 0) {
                    totalDuration += r.duration;
                } else if (isCurrent && idx === records.length - 1) {
                    totalDuration += (performance.now() - r.startTime);
                }
            });
            
            let orderText = "";
            if (isMouseOver || records.length <= 4) {
                orderText = records.map(r => `#${r.order}`).join(", ");
            } else {
                orderText = `#${records[0].order}, #${records[1].order} ... #${records[records.length-1].order}`;
            }

            const timeTxt = `${(totalDuration / 1000).toFixed(3)}s`;
            const fullTxt = `${orderText} | Total: ${timeTxt}`;
            
            ctx.font = "bold 14px sans-serif";
            const tw = ctx.measureText(fullTxt).width;
            const labelHeight = 22;
            const labelX = -margin;
            const labelY = -titleHeight - margin - labelHeight - 2;
            
            ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
            ctx.fillRect(labelX, labelY, tw + 15, labelHeight); 
            
            if (!isMouseOver && records.length > 4) {
                ctx.fillStyle = "#666";
                ctx.font = "10px sans-serif";
                ctx.fillText(" (Hover to expand)", labelX + tw + 18, labelY + labelHeight / 2 + 1);
            }

            ctx.font = "bold 14px sans-serif";
            ctx.fillStyle = isCurrent ? "#FFFF00" : "#00FF00";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(fullTxt, labelX + 7, labelY + labelHeight / 2);
            ctx.restore();
        };

        const origDrawLink = LGraphCanvas.prototype.drawLink;
        LGraphCanvas.prototype.drawLink = function(ctx, a, b, link, ...args) {
            if (executionState.enabled && link && executionState.executedNodes.has(String(link.origin_id)) && executionState.executedNodes.has(String(link.target_id))) {
                ctx.save();
                ctx.shadowBlur = 8;
                ctx.shadowColor = "#00FF00";
                ctx.lineWidth = (args[0] || 2) * 1.5; 
                const r = origDrawLink.apply(this, [ctx, a, b, link, ...args]);
                ctx.restore();
                return r;
            }
            return origDrawLink.apply(this, [ctx, a, b, link, ...args]);
        };

        this.createTracerUI();
    },

    finalizeNodeTiming(nodeId) {
        if (!nodeId) return;
        const records = executionState.nodes.get(String(nodeId));
        if (records && records.length > 0) {
            const last = records[records.length - 1];
            if (last && !last.endTime) {
                last.endTime = performance.now();
                last.duration = last.endTime - last.startTime;
            }
        }
    },

    createTracerUI() {
        const id = "mecha-tracer-panel";
        if (document.getElementById(id)) return;

        const container = document.createElement("div");
        container.id = id;
        const savedPos = JSON.parse(localStorage.getItem("mecha_tracer_pos") || '{"top":"60px","right":"20px"}');
        container.style.cssText = `
            display: ${executionState.panelVisible ? "flex" : "none"};
            flex-direction: column;
            gap: 5px;
            padding: 10px;
            background: rgba(15, 15, 15, 0.95);
            border: 1px solid #00FF00;
            border-radius: 8px;
            box-shadow: 0 0 15px rgba(0, 255, 0, 0.3);
            z-index: 99999;
            position: fixed;
            min-width: 180px;
            font-family: sans-serif;
            user-select: none;
        `;
        if (savedPos.left) container.style.left = savedPos.left;
        else container.style.right = savedPos.right;
        container.style.top = savedPos.top;

        const titleRow = document.createElement("div");
        titleRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; cursor: move;";
        const title = document.createElement("div");
        title.innerText = "Mecha Tracer";
        title.style.cssText = "color: #00FF00; font-weight: bold; font-size: 13px; pointer-events: none;";
        titleRow.appendChild(title);

        const controls = document.createElement("div");
        controls.style.cssText = "display: flex; align-items: center; gap: 8px;";
        const toggleWrap = document.createElement("label");
        toggleWrap.style.cssText = "display: flex; align-items: center; gap: 4px; cursor: pointer; color: #AAA; font-size: 10px;";
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = executionState.enabled;
        toggle.onclick = (e) => {
            e.stopPropagation();
            executionState.enabled = toggle.checked;
            localStorage.setItem("mecha_tracer_enabled", executionState.enabled);
            app.canvas.draw(true, true);
        };
        toggleWrap.appendChild(toggle);
        toggleWrap.appendChild(document.createTextNode("ON"));
        controls.appendChild(toggleWrap);

        const closeBtn = document.createElement("div");
        closeBtn.innerText = "×";
        closeBtn.style.cssText = "color: #888; cursor: pointer; font-size: 16px; font-weight: bold; line-height: 1;";
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            executionState.panelVisible = false;
            localStorage.setItem("mecha_tracer_panel_visible", "false");
            container.style.display = "none";
        };
        controls.appendChild(closeBtn);
        titleRow.appendChild(controls);
        container.appendChild(titleRow);

        let isDragging = false;
        let startX, startY;
        titleRow.onmousedown = (e) => {
            if (e.target === toggle || e.target === closeBtn) return;
            isDragging = true;
            startX = e.clientX - container.offsetLeft;
            startY = e.clientY - container.offsetTop;
            container.style.transition = "none";
        };
        document.onmousemove = (e) => {
            if (!isDragging) return;
            container.style.left = (e.clientX - startX) + "px";
            container.style.top = (e.clientY - startY) + "px";
            container.style.right = "auto";
        };
        document.onmouseup = () => {
            if (isDragging) {
                isDragging = false;
                localStorage.setItem("mecha_tracer_pos", JSON.stringify({ top: container.style.top, left: container.style.left }));
            }
        };

        const btnStyle = `background: #2a2a2a; color: #fff; border: 1px solid #444; padding: 6px; cursor: pointer; font-size: 11px; border-radius: 4px; text-align: left; transition: background 0.2s;`;
        const exportPureBtn = document.createElement("button");
        exportPureBtn.innerText = "🛠️ Export: Pure Path";
        exportPureBtn.onclick = () => this.exportWorkflow("pure");
        container.appendChild(exportPureBtn);

        const exportIntegrityBtn = document.createElement("button");
        exportIntegrityBtn.innerText = "🔗 Export: Logic Integrity";
        exportIntegrityBtn.onclick = () => this.exportWorkflow("integrity");
        container.appendChild(exportIntegrityBtn);

        const clearBtn = document.createElement("button");
        clearBtn.innerText = "🧹 Clear Tracer Records";
        clearBtn.style.cssText = btnStyle;
        clearBtn.onclick = () => {
            executionState.nodes.clear();
            executionState.executedNodes.clear();
            executionState.orderCounter = 0;
            app.canvas.draw(true, true);
        };
        container.appendChild(clearBtn);

        document.body.appendChild(container);

        const origGetCanvasMenuOptions = LGraphCanvas.prototype.getCanvasMenuOptions;
        const self = this;
        LGraphCanvas.prototype.getCanvasMenuOptions = function() {
            const options = origGetCanvasMenuOptions.apply(this, arguments);
            options.push(null); 
            options.push({
                content: executionState.enabled ? "🚫 Disable Mecha Tracer" : "✅ Enable Mecha Tracer",
                callback: () => {
                    executionState.enabled = !executionState.enabled;
                    localStorage.setItem("mecha_tracer_enabled", executionState.enabled);
                    toggle.checked = executionState.enabled;
                    app.canvas.draw(true, true);
                }
            });
            options.push({
                content: executionState.panelVisible ? "👁️ Hide Tracer Panel" : "👁️ Show Tracer Panel",
                callback: () => {
                    executionState.panelVisible = !executionState.panelVisible;
                    localStorage.setItem("mecha_tracer_panel_visible", executionState.panelVisible);
                    container.style.display = executionState.panelVisible ? "flex" : "none";
                }
            });
            options.push({
                content: "🛠️ Export: Pure Path",
                callback: () => self.exportWorkflow("pure")
            });
            options.push({
                content: "🔗 Export: Logic Integrity",
                callback: () => self.exportWorkflow("integrity")
            });
            options.push({
                content: "🧹 Mecha Tracer: Clear",
                callback: () => {
                    executionState.nodes.clear();
                    executionState.executedNodes.clear();
                    executionState.orderCounter = 0;
                    app.canvas.draw(true, true);
                }
            });
            return options;
        };
    },

    exportWorkflow(mode) {
        if (executionState.executedNodes.size === 0) {
            alert("请先运行一次工作流再导出！");
            return;
        }

        try {
            const graphData = JSON.parse(JSON.stringify(app.graph.serialize()));
            const executedIds = new Set(Array.from(executionState.executedNodes).map(id => Number(id)));
            const keepIdsSet = new Set(executedIds);

            if (mode === "integrity") {
                const nodesMap = {};
                graphData.nodes.forEach(n => nodesMap[n.id] = n);
                const linksMap = {};
                graphData.links.forEach(l => linksMap[l[0]] = l);

                const findAncestors = (nodeId) => {
                    const node = nodesMap[nodeId];
                    if (!node || !node.inputs) return;
                    node.inputs.forEach(input => {
                        if (input.link) {
                            const link = linksMap[input.link];
                            if (link && !keepIdsSet.has(link[1])) { // link[1] is origin_id
                                keepIdsSet.add(link[1]);
                                findAncestors(link[1]);
                            }
                        }
                    });
                };
                Array.from(executedIds).forEach(id => findAncestors(id));
            }

            const finalNodes = graphData.nodes.filter(n => keepIdsSet.has(n.id));
            const finalNodesIds = new Set(finalNodes.map(n => n.id));
            const finalLinks = graphData.links.filter(l => finalNodesIds.has(l[1]) && finalNodesIds.has(l[3]));
            const finalLinksIds = new Set(finalLinks.map(l => l[0]));

            finalNodes.forEach(node => {
                if (node.inputs) {
                    node.inputs.forEach(input => {
                        if (input.link && !finalLinksIds.has(input.link)) delete input.link;
                    });
                }
                if (node.outputs) {
                    node.outputs.forEach(output => {
                        if (output.links) {
                            output.links = output.links.filter(linkId => finalLinksIds.has(linkId));
                            if (output.links.length === 0) delete output.links;
                        }
                    });
                }
            });

            const newWorkflow = { ...graphData, nodes: finalNodes, links: finalLinks };
            const blob = new Blob([JSON.stringify(newWorkflow, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `mecha_tracer_${mode}_${new Date().getTime()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Mecha Tracer Export Error:", e);
            alert("导出过程中发生错误，请查看控制台日志。");
        }
    }
});
