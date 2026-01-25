import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

/**
 * ComfyUI-MechaBaby-WorkflowTracer
 * 功能：
 * 1. 修复现代节点 (Vue) 下鼠标悬停无法展开序号的问题
 * 2. 修复循环节点的累计耗时计算逻辑
 * 3. 兼容现代节点 (Vue) 与经典节点的高亮显示
 */

const executionState = {
    enabled: localStorage.getItem("mecha_tracer_enabled") !== "false",
    panelVisible: localStorage.getItem("mecha_tracer_panel_visible") !== "false",
    running: false,
    nodes: new Map(), // nodeId -> Array of { order, startTime, endTime, duration }
    orderCounter: 0,
    executedNodes: new Set(),
    lastNodeId: null,
    hoveredNodeId: null // 新增：手动追踪悬停节点ID
};

app.registerExtension({
    name: "MechaBaby.WorkflowTracer",
    
    async setup() {
        // 监听执行开始
        api.addEventListener("execution_start", () => {
            if (!executionState.enabled) return;
            executionState.nodes.clear();
            executionState.orderCounter = 0;
            executionState.executedNodes.clear();
            executionState.running = true;
            executionState.lastNodeId = null;
            app.canvas.draw(true, true);
        });

        // 监听节点执行
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

        // --- 核心修复：手动检测鼠标位置以支持现代节点 (Vue) 悬停 ---
        const self = this;
        const origDrawNode = LGraphCanvas.prototype.drawNode;
        LGraphCanvas.prototype.drawNode = function(node, ctx) {
            origDrawNode.apply(this, arguments);
            if (!executionState.enabled) return;
            
            const records = executionState.nodes.get(String(node.id));
            if (!records || records.length === 0) return;

            // 获取实时鼠标位置进行判定
            const canvas = app.canvas;
            const isMouseOver = canvas.node_over === node || executionState.hoveredNodeId === String(node.id);

            ctx.save();
            const titleHeight = LiteGraph.NODE_TITLE_HEIGHT || 20;
            const isCurrent = executionState.lastNodeId === String(node.id) && executionState.running;

            // 1. 绘制高亮边框
            ctx.strokeStyle = isCurrent ? "#FFFF00" : "#00FF00";
            ctx.lineWidth = isCurrent ? 5 : 3;
            ctx.shadowBlur = isCurrent ? 20 : 10;
            ctx.shadowColor = isCurrent ? "#FFFF00" : "#00FF00";
            const margin = 3;
            ctx.strokeRect(-margin, -titleHeight - margin, node.size[0] + margin * 2, node.size[1] + titleHeight + margin * 2);

            // 2. 格式化标签信息
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            
            // 耗时计算：仅当前运行的最后一条记录实时跳秒
            let totalDuration = 0;
            records.forEach((r, idx) => {
                if (r.duration > 0) {
                    totalDuration += r.duration;
                } else if (isCurrent && idx === records.length - 1) {
                    totalDuration += (performance.now() - r.startTime);
                }
            });
            
            // 序号显示逻辑：悬停显示完整版
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

        // 监听鼠标移动以更新 hoveredNodeId
        const canvasEl = app.canvas.canvas;
        canvasEl.addEventListener("pointermove", (e) => {
            if (!executionState.enabled) return;
            const canvas = app.canvas;
            const coord = canvas.convertEventToCanvasOffset(e);
            const node = canvas.graph.getNodeOnPos(coord[0], coord[1]);
            const newHoverId = node ? String(node.id) : null;
            if (executionState.hoveredNodeId !== newHoverId) {
                executionState.hoveredNodeId = newHoverId;
                canvas.draw(true, true); // 强制重绘以更新标签
            }
        });

        // 劫持连线渲染
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
            min-width: 170px;
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
            // 1. 深度克隆原始图表数据
            const graphData = JSON.parse(JSON.stringify(app.graph.serialize()));
            const executedIds = new Set(Array.from(executionState.executedNodes).map(id => Number(id)));
            const keepIdsSet = new Set(executedIds);

            // 2. 如果是逻辑完整模式，溯源所有祖先节点
            if (mode === "integrity") {
                const nodesMap = {};
                graphData.nodes.forEach(n => nodesMap[n.id] = n);
                const linksMap = {};
                if (graphData.links) {
                    graphData.links.forEach(l => {
                        if (l) linksMap[l[0]] = l; // l[0] 是 link_id
                    });
                }

                // 使用迭代（栈）代替递归，处理超大型工作流
                const stack = Array.from(executedIds);
                const visited = new Set(executedIds);

                // 闭包函数：执行一轮溯源（包括标准链路和虚拟链路）
                const traceOnce = () => {
                    let added = false;
                    while (stack.length > 0) {
                        const currId = stack.pop();
                        const node = nodesMap[currId];
                        if (!node) continue;

                        // --- A. 标准链路溯源 (Inputs -> Links -> OriginNode) ---
                        if (node.inputs) {
                            node.inputs.forEach(input => {
                                if (input.link) {
                                    const link = linksMap[input.link];
                                    if (link) {
                                        const originNodeId = link[1];
                                        if (!visited.has(originNodeId)) {
                                            visited.add(originNodeId);
                                            keepIdsSet.add(originNodeId);
                                            stack.push(originNodeId);
                                            added = true;
                                        }
                                    }
                                }
                            });
                        }

                        // --- B. 虚拟链路溯源 (GetNode -> SetNode, Anywhere) ---
                        // 逻辑：如果当前保留的是一个“获取”类节点，必须找到对应的“设置”类节点
                        const type = node.type?.toLowerCase() || "";
                        if (type.includes("get") || type.includes("anywhere")) {
                            // 尝试从 widgets_values 中找到标签名
                            const tags = (node.widgets_values || []).filter(v => typeof v === 'string' && v.length > 0);
                            if (tags.length > 0) {
                                graphData.nodes.forEach(potentialSet => {
                                    if (visited.has(potentialSet.id)) return;
                                    const pType = potentialSet.type?.toLowerCase() || "";
                                    // 匹配：类型包含 Set 且拥有相同的 Tag
                                    if (pType.includes("set") || pType.includes("anywhere")) {
                                        const pTags = (potentialSet.widgets_values || []).filter(v => typeof v === 'string');
                                        if (tags.some(t => pTags.includes(t))) {
                                            visited.add(potentialSet.id);
                                            keepIdsSet.add(potentialSet.id);
                                            stack.push(potentialSet.id);
                                            added = true;
                                        }
                                    }
                                });
                            }
                        }
                    }
                    return added;
                };

                // 循环溯源直到依赖链闭合
                while (traceOnce()) {}
                
                // --- C. 特殊兜底：强制保留特定的参数节点 (如 GeneralInput) ---
                graphData.nodes.forEach(n => {
                    if (!keepIdsSet.has(n.id)) {
                        const type = n.type || "";
                        if (type === "GeneralInput" || type.includes("Parameter")) {
                            keepIdsSet.add(n.id);
                        }
                    }
                });
            }

            // 3. 筛选节点
            const finalNodes = graphData.nodes.filter(n => keepIdsSet.has(n.id));
            const finalNodesIds = new Set(finalNodes.map(n => n.id));

            // 4. 筛选链接（只有两端节点都在保留列表中的链接才保留）
            let finalLinks = [];
            if (graphData.links) {
                finalLinks = graphData.links.filter(l => 
                    l && finalNodesIds.has(l[1]) && finalNodesIds.has(l[3])
                );
            }
            const finalLinksIds = new Set(finalLinks.map(l => l[0]));

            // 5. 清理残留的无效引用 (关键修复：确保结构完整，避免 ComfyUI 加载报错)
            finalNodes.forEach(node => {
                // 处理输入槽位
                if (node.inputs) {
                    node.inputs.forEach(input => {
                        if (input.link && !finalLinksIds.has(input.link)) {
                            input.link = null; // 断开指向已删除链接的引用
                        }
                    });
                }
                // 处理输出槽位
                if (node.outputs) {
                    node.outputs.forEach(output => {
                        if (output.links) {
                            // 只保留存在于 finalLinks 中的链接 ID
                            output.links = output.links.filter(linkId => finalLinksIds.has(linkId));
                        } else {
                            // 即使没有链接，也确保该属性为数组，防止某些节点插件读取崩溃
                            output.links = [];
                        }
                    });
                }
            });

            // 6. 生成新工作流对象
            const newWorkflow = { 
                ...graphData, 
                nodes: finalNodes, 
                links: finalLinks 
            };

            // 7. 执行下载
            const blob = new Blob([JSON.stringify(newWorkflow, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `mecha_tracer_${mode}_${new Date().getTime()}.json`;
            a.click();
            URL.revokeObjectURL(url);

        } catch (e) {
            console.error("Mecha Tracer Export Error:", e);
            alert("导出失败，请按F12查看控制台错误详情信息。");
        }
    }
});
