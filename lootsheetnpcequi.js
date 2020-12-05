import SimpleActorSheet from "../../systems/Equilibrium/module/actor-sheet.js";

class QuantityDialog extends Dialog {
    constructor(callback, options) {
        if (typeof (options) !== "object") {
            options = { };
        }

        let applyChanges = false;
        super({
            title: "Quantity",
            content: `
            <form>
                <div class="form-group">
                    <label>Quantity:</label>
                    <input type=number min="1" id="quantity" name="quantity" value="1">
                </div>
            </form>`,
            buttons: {
                yes: {
                    icon: "<i class='fas fa-check'></i>",
                    label: options.acceptLabel ? options.acceptLabel : "Accept",
                    callback: () => applyChanges = true
                },
                no: {
                    icon: "<i class='fas fa-times'></i>",
                    label: "Cancel"
                },
            },
            default: "yes",
            close: () => {
                if (applyChanges) {
                    var quantity = document.getElementById('quantity').value

                    if (isNaN(quantity)) {
                        console.log("Loot Sheet | Item quantity invalid");
                        return ui.notifications.error(`Item quantity invalid.`);
                    }

                    callback(quantity);

                }
            }
        });
    }
}

class LootSheetEquiNPC extends SimpleActorSheet {

    static SOCKET = "module.lootsheetnpcequi";

    get template() {
        // adding the #equals and #unequals handlebars helper
        Handlebars.registerHelper('equals', function(arg1, arg2, options) {
            return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
        });

        Handlebars.registerHelper('unequals', function(arg1, arg2, options) {
            return (arg1 != arg2) ? options.fn(this) : options.inverse(this);
        });

        Handlebars.registerHelper('lootsheetprice', function (basePrice, modifier) {
            return Math.round(basePrice * modifier * 100) / 100;
        });

        const path = "systems/Equilibrium/templates/";
        if (!game.user.isGM && this.actor.limited) return path + "actor-sheet.html";
        return "modules/lootsheetnpcequi/template/npc-sheet.html";
    }

    static get defaultOptions() {
        const options = super.defaultOptions;

        mergeObject(options, {
            classes: ["Equilibrium sheet actor npc npc-sheet loot-sheet-npc"],
            width: 890,
            height: 750
        });
        return options;
    }

    async getData() {
        const sheetData = super.getData();

        // Prepare GM Settings
        this._prepareGMSettings(sheetData.actor);

        // Prepare isGM attribute in sheet Data

        //console.log("game.user: ", game.user);
        if (game.user.isGM) sheetData.isGM = true;
        else sheetData.isGM = false;
        //console.log("sheetData.isGM: ", sheetData.isGM);
        //console.log(this.actor);
        
        let lootsheettype = await this.actor.getFlag("lootsheetnpcequi", "lootsheettype");
        if (!lootsheettype) await this.actor.setFlag("lootsheetnpcequi", "lootsheettype", "Loot");
        lootsheettype = await this.actor.getFlag("lootsheetnpcequi", "lootsheettype");

        
        let priceModifier = 1.0;
        if (lootsheettype === "Merchant") {
            priceModifier = await this.actor.getFlag("lootsheetnpcequi", "priceModifier");
            if (!priceModifier) await this.actor.setFlag("lootsheetnpcequi", "priceModifier", 1.0);
            priceModifier = await this.actor.getFlag("lootsheetnpcequi", "priceModifier");
        }

        sheetData.lootsheettype = lootsheettype;
        sheetData.priceModifier = priceModifier;
        sheetData.rolltables = game.tables.entities;
        sheetData.lootCurrency = game.settings.get("lootsheetnpcequi", "lootCurrency");
        sheetData.lootAll = game.settings.get("lootsheetnpcequi", "lootAll");

        // Return data for rendering
        return sheetData;
    }

    /* -------------------------------------------- */
    /*  Event Listeners and Handlers
    /* -------------------------------------------- */

    /**
     * Activate event listeners using the prepared sheet HTML
     * @param html {HTML}   The prepared HTML object ready to be rendered into the DOM
     */
    activateListeners(html) {
        super.activateListeners(html);
        if (this.options.editable) {
            // Toggle Permissions
            html.find('.permission-proficiency').click(ev => this._onCyclePermissionProficiency(ev));
            html.find('.permission-proficiency-bulk').click(ev => this._onCyclePermissionProficiencyBulk(ev));

            // Price Modifier
            html.find('.price-modifier').click(ev => this._priceModifier(ev));

            html.find('.merchant-settings').change(ev => this._merchantSettingChange(ev));
            html.find('.update-inventory').click(ev => this._merchantInventoryUpdate(ev));
        }

        // Split Coins
        html.find('.split-coins').removeAttr('disabled').click(ev => this._distributeCoins(ev));

        // Buy Item
        html.find('.item-buy').click(ev => this._buyItem(ev));

        // Loot Item
        html.find('.item-loot').click(ev => this._lootItem(ev));

        // Loot Currency
        html.find('.currency-loot').click(ev => this._lootCoins(ev));

        // Loot All
        html.find('.loot-all').removeAttr('disabled').click(ev => this._lootAll(ev, html));

        // Sheet Type
        html.find('.sheet-type').change(ev => this._changeSheetType(ev, html));

        // Roll Table
        //html.find('.sheet-type').change(ev => this._changeSheetType(ev, html));

    }

    /* -------------------------------------------- */

    /**
     * Handle merchant settings change
     * @private
     */
    async _merchantSettingChange(event, html) {
        event.preventDefault();
        console.log("Loot Sheet | Merchant settings changed");

        const moduleNamespace = "lootsheetnpcequi";
        const expectedKeys = ["rolltable", "shopQty", "itemQty"];

        let targetKey = event.target.name.split('.')[3];

        if (expectedKeys.indexOf(targetKey) === -1) {
            console.log(`Loot Sheet | Error changing stettings for "${targetKey}".`);
            return ui.notifications.error(`Error changing stettings for "${targetKey}".`);
        }

        if (event.target.value) {
            await this.actor.setFlag(moduleNamespace, targetKey, event.target.value);
        } else {
            await this.actor.unsetFlag(moduleNamespace, targetKey, event.target.value);
        }
    }

    /* -------------------------------------------- */

    /**
     * Handle merchant inventory update
     * @private
     */
    async _merchantInventoryUpdate(event, html) {
        event.preventDefault();

        const moduleNamespace = "lootsheetnpcequi";
        const rolltableName = this.actor.getFlag(moduleNamespace, "rolltable");
        const shopQtyFormula = this.actor.getFlag(moduleNamespace, "shopQty") || "1";
        const itemQtyFormula = this.actor.getFlag(moduleNamespace, "itemQty") || "1";

        let rolltable = game.tables.getName(rolltableName);
        if (!rolltable) {
            //console.log(`Loot Sheet | No Rollable Table found with name "${rolltableName}".`);
            return ui.notifications.error(`No Rollable Table found with name "${rolltableName}".`);
        }

        //console.log(rolltable);

        let clearInventory = game.settings.get("lootsheetnpcequi", "clearInventory");

        if (clearInventory) {
            
            let currentItems = this.actor.data.items.map(i => i._id);
            await this.actor.deleteEmbeddedEntity("OwnedItem", currentItems);
            //console.log(currentItems);
        }

        let shopQtyRoll = new Roll(shopQtyFormula);

        shopQtyRoll.roll();
        //console.log(`Loot Sheet | Adding ${shopQtyRoll.result} new items`);

        for (let i = 0; i < shopQtyRoll.result; i++) {
            const rollResult = rolltable.roll();
            //console.log(rollResult);
            let newItem = null;
            
            if (rollResult.results[0].collection === "Item") {
                newItem = game.items.get(rollResult.results[0].resultId);
            }
            else {
                //Try to find it in the compendium
                const items = game.packs.get(rollResult.results[0].collection);
                //dndequiitems.getIndex().then(index => console.log(index));
                //let newItem = dndequiitems.index.find(e => e.id === rollResult.results[0].resultId);
                items.getEntity(rollResult.results[0].resultId).then(i => console.log(i));
                newItem = await items.getEntity(rollResult.results[0].resultId);
            }
            if (!newItem || newItem === null) {
                //console.log(`Loot Sheet | No item found "${rollResult.results[0].resultId}".`);
                return ui.notifications.error(`No item found "${rollResult.results[0].resultId}".`);
            }

            let itemQtyRoll = new Roll(itemQtyFormula);
            itemQtyRoll.roll();
            //console.log(`Loot Sheet | Adding ${itemQtyRoll.result} x ${newItem.name}`)
            newItem.data.data.quantity = itemQtyRoll.result;

            await this.actor.createEmbeddedEntity("OwnedItem", newItem);
        }
    }

    _createRollTable() {

        let type = "weapon";

        game.packs.map(p => p.collection);

        const pack = game.packs.find(p => p.collection === "Equilibrium.items");

        let i = 0;

        let output = [];

        pack.getIndex().then(index => index.forEach(function (arrayItem) {
            var x = arrayItem._id;
            //console.log(arrayItem);
            i++;
            pack.getEntity(arrayItem._id).then(packItem => {
                
                if (packItem.type === type) {

                    //console.log(packItem);

                    let newItem = {
                        "_id": packItem._id,
                        "flags": {},
                        "type": 1,
                        "text": packItem.name,
                        "img": packItem.img,
                        "collection": "Item",
                        "resultId": packItem._id,
                        "weight": 1,
                        "range": [
                            i,
                            i
                          ],
                          "drawn": false
                    };

                    output.push(newItem);

                }
            });
        }));

        console.log(output);
        return;
    }

    /* -------------------------------------------- */

    /**
     * Handle sheet type change
     * @private
     */
    async _changeSheetType(event, html) {
        event.preventDefault();
        console.log("Loot Sheet | Sheet Type changed", event);

        let currentActor = this.actor;

        let selectedIndex = event.target.selectedIndex;

        let selectedItem = event.target[selectedIndex].value;

        await currentActor.setFlag("lootsheetnpcequi", "lootsheettype", selectedItem);
        
    }

    /* -------------------------------------------- */

    /**
     * Handle buy item
     * @private
     */
    _buyItem(event) {
        event.preventDefault();
        console.log("Loot Sheet | Buy Item clicked");

        let targetGm = null;
        game.users.forEach((u) => {
            if (u.isGM && u.active && u.viewedScene === game.user.viewedScene) {
                targetGm = u;
            }
        });

        if (!targetGm) {
            return ui.notifications.error("No active GM on your scene, they must be online and on the same scene to purchase an item.");
        }

        if (this.token === null) {
            return ui.notifications.error(`You must purchase items from a token.`);
        }
        if (!game.user.actorId) {
            console.log("Loot Sheet | No active character for user");
            return ui.notifications.error(`No active character for user.`);
        }

        let itemId = $(event.currentTarget).parents(".item").attr("data-item-id");
        const item = this.actor.getEmbeddedEntity("OwnedItem", itemId);

        const packet = {
            type: "buy",
            buyerId: game.user.actorId,
            tokenId: this.token.id,
            itemId: itemId,
            quantity: 1,
            processorId: targetGm.id
        };

        if (event.shiftKey) {
            packet.quantity = item.data.quantity;
        }

        if (item.data.quantity === packet.quantity) {
            console.log("LootSheetequi", "Sending buy request to " + targetGm.name, packet);
            game.socket.emit(LootSheetEquiNPC.SOCKET, packet);
            return;
        }

        let d = new QuantityDialog((quantity) => {
                packet.quantity = quantity;
                console.log("LootSheetequi", "Sending buy request to " + targetGm.name, packet);
                game.socket.emit(LootSheetEquiNPC.SOCKET, packet);
            },
            {
                acceptLabel: "Purchase"
            }
        );
        d.render(true);
    }

    /* -------------------------------------------- */

    /**
     * Handle Loot item
     * @private
     */
    _lootItem(event) {
        event.preventDefault();
        console.log("Loot Sheet | Loot Item clicked");

        let targetGm = null;
        game.users.forEach((u) => {
            if (u.isGM && u.active && u.viewedScene === game.user.viewedScene) {
                targetGm = u;
            }
        });

        if (!targetGm) {
            return ui.notifications.error("No active GM on your scene, they must be online and on the same scene to purchase an item.");
        }

        if (this.token === null) {
            return ui.notifications.error(`You must loot items from a token.`);
        }
        if (!game.user.actorId) {
            console.log("Loot Sheet | No active character for user");
            return ui.notifications.error(`No active character for user.`);
        }

        const itemId = $(event.currentTarget).parents(".item").attr("data-item-id");
        const targetItem = this.actor.getEmbeddedEntity("OwnedItem", itemId);

        const item = {itemId: itemId, quantity: 1};
        if (event.shiftKey) {
            item.quantity = targetItem.data.quantity;
        }

        const packet = {
            type: "loot",
            looterId: game.user.actorId,
            tokenId: this.token.id,
            items: [item],
            processorId: targetGm.id
        };

        if (targetItem.data.quantity === item.quantity) {
            console.log("LootSheetequi", "Sending loot request to " + targetGm.name, packet);
            game.socket.emit(LootSheetEquiNPC.SOCKET, packet);
            return;
        }

        const d = new QuantityDialog((quantity) => {
                packet.items[0]['quantity'] = quantity;
                console.log("LootSheetequi", "Sending loot request to " + targetGm.name, packet);
                game.socket.emit(LootSheetEquiNPC.SOCKET, packet);
            },
            {
                acceptLabel: "Loot"
            }
        );
        d.render(true);
    }

    /* -------------------------------------------- */

    /**
     * Handle Loot coins
     * @private
     */
    _lootCoins(event) {
        event.preventDefault();
        if (!game.settings.get("lootsheetnpcequi", "lootCurrency")) {
            return;
        }
        console.log("Loot Sheet | Loot Coins clicked");

        let targetGm = null;
        game.users.forEach((u) => {
            if (u.isGM && u.active && u.viewedScene === game.user.viewedScene) {
                targetGm = u;
            }
        });

        if (!targetGm) {
            return ui.notifications.error("No active GM on your scene, they must be online and on the same scene to loot coins.");
        }

        if (this.token === null) {
            return ui.notifications.error(`You must loot coins from a token.`);
        }
        if (!game.user.actorId) {
            console.log("Loot Sheet | No active character for user");
            return ui.notifications.error(`No active character for user.`);
        }

        const packet = {
            type: "lootCoins",
            looterId: game.user.actorId,
            tokenId: this.token.id,
            processorId: targetGm.id
        };
        console.log("LootSheetequi", "Sending loot request to " + targetGm.name, packet);
        game.socket.emit(LootSheetEquiNPC.SOCKET, packet);
    }

    /* -------------------------------------------- */

    /**
     * Handle Loot all
     * @private
     */
    _lootAll(event, html) {
        event.preventDefault();
        console.log("Loot Sheet | Loot All clicked");
        this._lootCoins(event);

        let targetGm = null;
        game.users.forEach((u) => {
            if (u.isGM && u.active && u.viewedScene === game.user.viewedScene) {
                targetGm = u;
            }
        });

        if (!targetGm) {
            return ui.notifications.error("No active GM on your scene, they must be online and on the same scene to purchase an item.");
        }

        if (this.token === null) {
            return ui.notifications.error(`You must loot items from a token.`);
        }
        if (!game.user.actorId) {
            console.log("Loot Sheet | No active character for user");
            return ui.notifications.error(`No active character for user.`);
        }

        const itemTargets = html.find('.item[data-item-id]');
        if (!itemTargets) {
            return;
        }

        const items = [];
        for (let i of itemTargets) {
            const itemId = i.getAttribute("data-item-id");
            const item = this.actor.getEmbeddedEntity("OwnedItem", itemId);
            items.push({itemId: itemId, quantity: item.data.quantity});
        }
        if (items.length === 0) {
            return;
        }

        const packet = {
            type: "loot",
            looterId: game.user.actorId,
            tokenId: this.token.id,
            items: items,
            processorId: targetGm.id
        };

        console.log("LootSheetequi", "Sending loot request to " + targetGm.name, packet);
        game.socket.emit(LootSheetEquiNPC.SOCKET, packet);
    }

    /* -------------------------------------------- */

    /**
     * Handle price modifier
     * @private
     */
    async _priceModifier(event) {
        event.preventDefault();
        //console.log("Loot Sheet | Price Modifier clicked");
        //console.log(this.actor.isToken);

        let priceModifier = await this.actor.getFlag("lootsheetnpcequi", "priceModifier");
        if (!priceModifier) priceModifier = 1.0;

        priceModifier = Math.round(priceModifier * 100);

        var html = "<p>Use this slider to increase or decrease the price of all items in this inventory. <i class='fa fa-question-circle' title='This uses a percentage factor where 100% is the current price, 0% is 0, and 200% is double the price.'></i></p>";
        html += '<p><input name="price-modifier-percent" id="price-modifier-percent" type="range" min="0" max="200" value="'+priceModifier+'" class="slider"></p>';
        html += '<p><label>Percentage:</label> <input type=number min="0" max="200" value="'+priceModifier+'" id="price-modifier-percent-display"></p>';
        html += '<script>var pmSlider = document.getElementById("price-modifier-percent"); var pmDisplay = document.getElementById("price-modifier-percent-display"); pmDisplay.value = pmSlider.value; pmSlider.oninput = function() { pmDisplay.value = this.value; }; pmDisplay.oninput = function() { pmSlider.value = this.value; };</script>';

        let d = new Dialog({
            title: "Price Modifier",
            content: html,
            buttons: {
             one: {
              icon: '<i class="fas fa-check"></i>',
              label: "Update",
              callback: () => this.actor.setFlag("lootsheetnpcequi", "priceModifier", document.getElementById("price-modifier-percent").value / 100)
             },
             two: {
              icon: '<i class="fas fa-times"></i>',
              label: "Cancel",
              callback: () => console.log("Loot Sheet | Price Modifier Cancelled")
             }
            },
            default: "two",
            close: () => console.log("Loot Sheet | Price Modifier Closed")
        });
        d.render(true);
    }

    /* -------------------------------------------- */

    /**
     * Handle distribution of coins
     * @private
     */
    _distributeCoins(event) {
        event.preventDefault();
        //console.log("Loot Sheet | Split Coins clicked");

        let targetGm = null;
        game.users.forEach((u) => {
            if (u.isGM && u.active && u.viewedScene === game.user.viewedScene) {
                targetGm = u;
            }
        });

        if (!targetGm) {
            return ui.notifications.error("No active GM on your scene, they must be online and on the same scene to purchase an item.");
        }

        if (this.token === null) {
            return ui.notifications.error(`You must loot items from a token.`);
        }

        if (game.user.isGM) {
            //don't use socket
            let container = canvas.tokens.get(this.token.id);
            this._hackydistributeCoins(container.actor);
            return;
        }
        
        const packet = {
            type: "distributeCoins",
            looterId: game.user.actorId,
            tokenId: this.token.id,
            processorId: targetGm.id
        };
        console.log("LootSheetequi", "Sending distribute coins request to " + targetGm.name, packet);
        game.socket.emit(LootSheetEquiNPC.SOCKET, packet);
    }

    _hackydistributeCoins(containerActor) {
        //This is identical as the distributeCoins function defined in the init hook which for some reason can't be called from the above _distributeCoins method of the LootSheetNPCequi class. I couldn't be bothered to figure out why a socket can't be called as the GM... so this is a hack but it works.
        
        let actorData = containerActor.data
        let observers = [];
        //console.log("Loot Sheet | actorData", actorData);
        // Calculate observers
        for (let u in actorData.permission) {
            if (u != "default" && actorData.permission[u] >= 2) {
                //console.log("Loot Sheet | u in actorData.permission", u);
                let player = game.users.get(u);
                //console.log("Loot Sheet | player", player);
                let actor = game.actors.get(player.data.character);
                //console.log("Loot Sheet | actor", actor);
                if (actor !== null && (player.data.role === 1 || player.data.role === 2)) observers.push(actor);
            }
        }

        //console.log("Loot Sheet | observers", observers);
        if (observers.length === 0) return;

        // Calculate split of currency
        let currencySplit = duplicate(actorData.data.attributes.currency);
        //console.log("Loot Sheet | Currency data", currencySplit);
        
        // keep track of the remainder
        let currencyRemainder = 0;

        if (observers.length) {                
            // calculate remainder
            currencyRemainder = (currencySplit % observers.length);
            //console.log("Remainder: " + currencyRemainder[c]);

            currencySplit = Math.floor(currencySplit / observers.length);
        }
        else currencySplit = 0;

        // add currency to actors existing coins
        let msg = [];
        for (let u of observers) {
            //console.log("Loot Sheet | u of observers", u);
            if (u === null) continue;

            msg = [];
            let currency = u.data.data.attributes.currency,
                newCurrency = duplicate(u.data.data.attributes.currency);

            //console.log("Loot Sheet | Current Currency", currency);

                // add msg for chat description
            if (currencySplit) {
                //console.log("Loot Sheet | New currency for " + c, currencySplit[c]);
                msg.push(` ${currencySplit} coins`)
            }
            if (currencySplit != null) {
                // Add currency to permitted actor
                newCurrency = parseInt(currency || 0) + currencySplit;
                u.update({
                    'data.attributes.currency': newCurrency
                });
            }

            // Remove currency from loot actor.
            containerActor.update({
                "data.attributes.currency": currencyRemainder
            });

            // Create chat message for coins received
            if (msg.length != 0) {
                let message = `${u.data.name} receives: `;
                message += msg.join(",");
                ChatMessage.create({
                    user: game.user._id,
                    speaker: {
                        actor: containerActor,
                        alias: containerActor.name
                    },
                    content: message
                });
            }
        }
    }

    /* -------------------------------------------- */

    /**
     * Handle cycling permissions
     * @private
     */
    _onCyclePermissionProficiency(event) {
        
        event.preventDefault();

        //console.log("Loot Sheet | this.actor.data.permission", this.actor.data.permission);


        let actorData = this.actor.data;


        let field = $(event.currentTarget).siblings('input[type="hidden"]');

        let level = parseFloat(field.val());
        if (typeof level === undefined) level = 0;

        //console.log("Loot Sheet | current level " + level);

        const levels = [0, 3, 2]; //const levels = [0, 2, 3];

        let idx = levels.indexOf(level),
            newLevel = levels[(idx === levels.length - 1) ? 0 : idx + 1];

        //console.log("Loot Sheet | new level " + newLevel);

        let playerId = field[0].name;

        //console.log("Loot Sheet | Current actor: " + playerId);

        this._updatePermissions(actorData, playerId, newLevel, event);

        this._onSubmit(event);
    }

    /* -------------------------------------------- */

    /**
     * Handle cycling bulk permissions
     * @private
     */
    _onCyclePermissionProficiencyBulk(event) {
        event.preventDefault();

        let actorData = this.actor.data;

        let field = $(event.currentTarget).parent().siblings('input[type="hidden"]');
        let level = parseFloat(field.val());
        if (typeof level === undefined || level === 999) level = 0;

        const levels = [0, 3, 2]; //const levels = [0, 2, 3];

        let idx = levels.indexOf(level),
            newLevel = levels[(idx === levels.length - 1) ? 0 : idx + 1];

        let users = game.users.entities;

        let currentPermissions = duplicate(actorData.permission);
        for (let u of users) {
            if (u.data.role === 1 || u.data.role === 2) {
                currentPermissions[u._id] = newLevel;
            }
        }
        const lootPermissions = new PermissionControl(this.actor);
        lootPermissions._updateObject(event, currentPermissions)

        this._onSubmit(event);
    }

    _updatePermissions(actorData, playerId, newLevel, event) {
        // Read player permission on this actor and adjust to new level
        let currentPermissions = duplicate(actorData.permission);
        currentPermissions[playerId] = newLevel;
        // Save updated player permissions
        const lootPermissions = new PermissionControl(this.actor);
        lootPermissions._updateObject(event, currentPermissions);
    }

    /* -------------------------------------------- */

    /**
     * Organize and classify Items for Loot NPC sheets
     * @private
     */
    _prepareItems(actorData) {

        //console.log("Loot Sheet | Prepare Features");
        // Actions
        const features = {
            weapons: {
                label: "Weapons",
                items: [],
                type: "weapon"
            },
            armors: {
                label: "Armors",
                items: [],
                type: "armors"
            },
            items: {
                label: "Items",
                items: [],
                type: "item"
            }
            
        };

        //console.log("Loot Sheet | Prepare Items");
        // Iterate through items, allocating to containers
        for (let i of actorData.items) {
            i.img = i.img || DEFAULT_TOKEN;
			//console.log("Loot Sheet | item", i);
			
            // Features
            if (i.type === "weapon") features.weapons.items.push(i);
            else if (i.type === "armors") features.armors.items.push(i);
            // else if (i.type === "item") features.consumables.items.push(i);
            // else if (i.type === "tool") features.tools.items.push(i);
            // else if (["container", "backpack"].includes(i.type)) features.containers.items.push(i);
            // else if (i.type === "loot") features.loot.items.push(i);
            else features.items.items.push(i);
        }

        // Assign and return
        //actorData.features = features;
        actorData.actor.features = features;
        //console.log(this.actor);
    }

    /* -------------------------------------------- */


    /**
     * Get the font-awesome icon used to display the permission level.
     * @private
     */
    _getPermissionIcon(level) {
        const icons = {
            0: '<i class="far fa-circle"></i>',
            2: '<i class="fas fa-eye"></i>',
            3: '<i class="fas fa-check"></i>',
            999: '<i class="fas fa-users"></i>'
        };
        return icons[level];
    }

    /* -------------------------------------------- */

    /**
     * Get the font-awesome icon used to display the permission level.
     * @private
     */
    _getPermissionDescription(level) {
        const description = {
            0: "None (cannot access sheet)",
            2: "Observer (access to sheet but can only purchase items if merchant sheet type)",
            3: "Owner (can access items and share coins)",
            999: "Change all permissions"
        };
        return description[level];
    }


    /* -------------------------------------------- */

    /**
     * Prepares GM settings to be rendered by the loot sheet.
     * @private
     */
    _prepareGMSettings(actorData) {

        const players = [],
            observers = [];
        let users = game.users.entities;
        let commonPlayersPermission = -1;

        //console.log("Loot Sheet _prepareGMSettings | actorData.permission", actorData.permission);

        for (let u of users) {
            //console.log("Loot Sheet | Checking user " + u.data.name, u);

            //check if the user is a player 
            if (u.data.role === 1 || u.data.role === 2) {

                // get the name of the primary actor for a player
                const actor = game.actors.get(u.data.character);
                //console.log("Loot Sheet | Checking actor", actor);

                if (actor) {
					
                    u.actor = actor.data.name;
                    u.actorId = actor.data._id;
                    u.playerId = u.data._id;

					//Check if there are default permissions to the actor
                    if (typeof actorData.permission.default !== "undefined") {

                        //console.log("Loot Sheet | default permissions", actorData.permission.default);

                        u.lootPermission = actorData.permission.default;

                        if (actorData.permission.default >= 2 && !observers.includes(actor.data._id)) {

                            observers.push(actor.data._id);
                        }
						
                    } else {
						
                        u.lootPermission = 0;
                        //console.log("Loot Sheet | assigning 0 permission to hidden field");
                    }

                    //if the player has some form of permission to the object update the actorData
                    if (u.data._id in actorData.permission && !observers.includes(actor.data._id)) {
                        //console.log("Loot Sheet | Found individual actor permission");

                        u.lootPermission = actorData.permission[u.data._id];
                        //console.log("Loot Sheet | assigning " + actorData.permission[u.data._id] + " permission to hidden field");

                        if (actorData.permission[u.data._id] >= 2) {
                            observers.push(actor.data._id);
                        }
                    }

					//Set icons and permission texts for html
                    //console.log("Loot Sheet | lootPermission", u.lootPermission);
                    if (commonPlayersPermission < 0) {
                        commonPlayersPermission = u.lootPermission;
                    } else if (commonPlayersPermission !== u.lootPermission) {
                        commonPlayersPermission = 999;
                    }
                    u.icon = this._getPermissionIcon(u.lootPermission);
                    u.lootPermissionDescription = this._getPermissionDescription(u.lootPermission);
                    players.push(u);
                }
            }
        }

        // calculate the split of coins between all observers of the sheet.
        let currencySplit = duplicate(actorData.data.attributes.currency);
        if (observers.length)
            currencySplit = Math.floor(currencySplit / observers.length);
        else
            currencySplit = 0

        let loot = {}
        loot.players = players;
        loot.observerCount = observers.length;
        loot.currency = currencySplit;
        loot.playersPermission = commonPlayersPermission;
        loot.playersPermissionIcon = this._getPermissionIcon(commonPlayersPermission);
        loot.playersPermissionDescription = this._getPermissionDescription(commonPlayersPermission);
        actorData.flags.loot = loot;
    }


}

//Register the loot sheet
Actors.registerSheet("equilibrium", LootSheetEquiNPC, {
    makeDefault: false
});


/**
 * Register a hook to convert any spell created on an actor with the LootSheetEquiNPC sheet to a consumable scroll.
 */
Hooks.on('preCreateOwnedItem', (actor, item, data) => {
    
    // console.log("Loot Sheet | actor", actor);
    // console.log("Loot Sheet | item", item);
    // console.log("Loot Sheet | data", data);

    if (!actor) throw new Error(`Parent Actor ${actor._id} not found`);

    // Check if Actor is an NPC
    if (actor.data.type === "character") return;
    
    // If the actor is using the LootSheetEquiNPC then check in the item is a spell and if so update the name.
    if ((actor.data.flags.core || {}).sheetClass === "dndequi.LootSheetEquiNPC") {
        if (item.type === "spell") {
            //console.log("Loot Sheet | dragged spell item", item);

            let changeScrollIcon = game.settings.get("lootsheetnpcequi", "changeScrollIcon");

            if (changeScrollIcon) item.img = "modules/lootsheetnpcequi/icons/Scroll" + item.data.level + ".png";

            //console.log("Loot Sheet | check changeScrollIcon", changeScrollIcon);

            item.name = "Scroll of " + item.name;
            item.type = "consumable";
            item.data.price = Math.round(10 * Math.pow(2.6, item.data.level));
            //console.log("Loot Sheet | price of scroll", item.data.price);
            item.data.autoDestroy = {
                label: "Destroy on Empty",
                type: "Boolean",
                value: true
            }
            item.data.autoUse = {
                label: "Consume on Use",
                type: "Boolean",
                value: true
            }
            item.data.charges = {
                label: "Charges",
                max: 1,
                type: "Number",
                value: 1
            }
            item.data.consumableType = {
                label: "Consumable Type",
                type: "String",
                value: "scroll"
            }
        }
    } else return;

});

Hooks.once("init", () => {
    
    Handlebars.registerHelper('ifeq', function (a, b, options) {
        if (a == b) { return options.fn(this); }
        return options.inverse(this);
    });
	
	game.settings.register("lootsheetnpcequi", "convertCurrency", {
		name: "Convert currency after purchases?",
		hint: "If enabled, all currency will be converted to the highest denomination possible after a purchase. If disabled, currency will subtracted simply.", 
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});

	game.settings.register("lootsheetnpcequi", "changeScrollIcon", {
		name: "Change icon for Spell Scrolls?",
		hint: "Changes the icon for spell scrolls to a scroll icon. If left unchecked, retains the spell's icon.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean
    });
    
    game.settings.register("lootsheetnpcequi", "buyChat", {
            name: "Display chat message for purchases?",
            hint: "If enabled, a chat message will display purchases of items from the loot sheet.",
            scope: "world",
            config: true,
            default: true,
            type: Boolean
    });

    game.settings.register("lootsheetnpcequi", "clearInventory", {
		  name: "Clear inventory?",
      hint: "If enabled, all existing items will be removed from the Loot Sheet before adding new items from the rollable table. If disabled, existing items will remain.",
      scope: "world",
      config: true,
      default: false,
      type: Boolean
    });

    game.settings.register("lootsheetnpcequi", "lootCurrency", {
		  name: "Loot currency?",
      hint: "If enabled, players will have the option to loot all currency to their character, in addition to splitting the currency between players.",
      scope: "world",
      config: true,
      default: true,
      type: Boolean
    });

    game.settings.register("lootsheetnpcequi", "lootAll", {
		  name: "Loot all?",
      hint: "If enabled, players will have the option to loot all items to their character, currency will follow the 'Loot Currency?' setting upon Loot All.",
      scope: "world",
      config: true,
      default: true,
      type: Boolean
    });

    function chatMessage (speaker, owner, message, item) {
        if (game.settings.get("lootsheetnpcequi", "buyChat")) {
            message =   `
            <div class="dndequi chat-card item-card" data-actor-id="${owner._id}" data-item-id="${item._id}">
                <header class="card-header flexrow">
                    <img src="${item.img}" title="${item.name}" width="36" height="36">
                    <h3 class="item-name">${item.name}</h3>
                </header>

                <div class="card-content">
                    <p>` + message + `</p>
                </div>
            </div>
            `;
            ChatMessage.create({
                user: game.user._id,
                speaker: {
                    actor: speaker,
                    alias: speaker.name
                },
                content: message
            });
        }
    }

	
    function errorMessageToActor(target, message) {
        game.socket.emit(LootSheetEquiNPC.SOCKET, {
            type: "error",
            targetId: target.id,
            message: message
        });
    }

    async function moveItems(source, destination, items) {
        const updates = [];
        const deletes = [];
        const additions = [];
        const results = [];
        for (let i of items) {
            let itemId = i.itemId;
            let quantity = i.quantity;
            let item = source.getEmbeddedEntity("OwnedItem", itemId);

            // Move all items if we select more than the quantity.
            if (item.data.quantity < quantity) {
                quantity = item.data.quantity;
            }

            let newItem = duplicate(item);
            const update = {_id: itemId, "data.quantity": item.data.quantity - quantity};

            if (update["data.quantity"] === 0) {
                deletes.push(itemId);
            }
            else {
                updates.push(update);
            }

            newItem.data.quantity = quantity;
            additions.push(newItem);
            results.push({
                item: newItem,
                quantity: quantity
            });
        }

        if (deletes.length > 0) {
            await source.deleteEmbeddedEntity("OwnedItem", deletes);
        }

        if (updates.length > 0) {
            await source.updateEmbeddedEntity("OwnedItem", updates);
        }

        if (additions.length > 0) {
            await destination.createEmbeddedEntity("OwnedItem", additions);
        }

        return results;
    }

    async function lootItems(container, looter, items) {
        let moved = await moveItems(container, looter, items);

        for (let m of moved) {
            chatMessage(
                container, looter,
                `${looter.name} looted ${m.quantity} x ${m.item.name}.`,
                m.item);
        }
    }

    async function transaction(seller, buyer, itemId, quantity) {
        let sellItem = seller.getEmbeddedEntity("OwnedItem", itemId);

        // If the buyer attempts to buy more then what's in stock, buy all the stock.
        if (sellItem.data.quantity < quantity) {
            quantity = sellItem.data.quantity;
        }

        let sellerModifier = seller.getFlag("lootsheetnpcequi", "priceModifier");
        if (!sellerModifier) sellerModifier = 1.0;

        let itemCost = Math.round(sellItem.data.price * sellerModifier * 100)  / 100;
        itemCost *= quantity;
        let buyerFunds = duplicate(buyer.data.data.attributes.currency);

        if (itemCost > buyerFunds) {
            errorMessageToActor(buyer, `Not enough funds to purchase item.`);
            return;
        }
				
        buyerFunds -= itemCost;
			
        // Update buyer's gold from the buyer.
        buyer.update({"data.attributes.currency": buyerFunds});
        let moved = await moveItems(seller, buyer, [{itemId, quantity}]);

        for (let m of moved) {
            chatMessage(
                seller, buyer,
                `${buyer.name} purchases ${quantity} x ${m.item.name} for ${itemCost} courones.`,
                m.item);
        }
    }

    function distributeCoins(containerActor) {
        let actorData = containerActor.data
        let observers = [];
        //console.log("Loot Sheet | actorData", actorData);
        // Calculate observers
        for (let u in actorData.permission) {
            if (u != "default" && actorData.permission[u] >= 2) {
                //console.log("Loot Sheet | u in actorData.permission", u);
                let player = game.users.get(u);
                //console.log("Loot Sheet | player", player);
                let actor = game.actors.get(player.data.character);
                //console.log("Loot Sheet | actor", actor);
                if (actor !== null && (player.data.role === 1 || player.data.role === 2)) observers.push(actor);
            }
        }

        //console.log("Loot Sheet | observers", observers);
        if (observers.length === 0) return;

        // Calculate split of currency
        let currencySplit = duplicate(actorData.data.attributes.currency);
        //console.log("Loot Sheet | Currency data", currencySplit);
        
        // keep track of the remainder
        let currencyRemainder =0;

        if (observers.length) {                
            // calculate remainder
            currencyRemainder = (currencySplit % observers.length);
            //console.log("Remainder: " + currencyRemainder[c]);

            currencySplit = Math.floor(currencySplit / observers.length);
        }
        else currencySplit = 0;

        // add currency to actors existing coins
        let msg = [];
        for (let u of observers) {
            //console.log("Loot Sheet | u of observers", u);
            if (u === null) continue;

            msg = [];
            let currency = u.data.data.attributes.currency,
                newCurrency = duplicate(u.data.data.attributes.currency);

            //console.log("Loot Sheet | Current Currency", currency);

                // add msg for chat description
                if (currencySplit) {
                    //console.log("Loot Sheet | New currency for " + c, currencySplit[c]);
                    msg.push(` ${currencySplit} coins`)
                }

                // Add currency to permitted actor
                newCurrency = parseInt(currency || 0) + currencySplit;

                //console.log("Loot Sheet | New Currency", newCurrency);
                u.update({
                    'data.attributes.currency': newCurrency
                });

            // Remove currency from loot actor.
            containerActor.update({
                "data.attributes.currency": currencyRemainder
            });

            // Create chat message for coins received
            if (msg.length != 0) {
                let message = `${u.data.name} receives: `;
                message += msg.join(",");
                ChatMessage.create({
                    user: game.user._id,
                    speaker: {
                        actor: containerActor,
                        alias: containerActor.name
                    },
                    content: message
                });
            }
        }
    }

    function lootCoins(containerActor, looter) {
        let actorData = containerActor.data

        let sheetCurrency = actorData.data.attributes.currency;
        //console.log("Loot Sheet | Currency data", currency);

        // add currency to actors existing coins
        let msg = [];
        let currency = looter.data.data.attributes.currency,
            newCurrency = duplicate(looter.data.data.attributes.currency);

        //console.log("Loot Sheet | Current Currency", currency);

        // add msg for chat description
        if (sheetCurrency) {
            //console.log("Loot Sheet | New currency for " + c, currencySplit[c]);
            msg.push(` ${sheetCurrency} coins`)
        }
        if (sheetCurrency) {
            // Add currency to permitted actor
            newCurrency = parseInt(currency || 0) + parseInt(sheetCurrency);
            looter.update({
                'data.attributes.currency': newCurrency
            });
        }

        // Remove currency from loot actor.
        containerActor.update({
            "data.attributes.currency": currencyRemainder
        });

        // Create chat message for coins received
        if (msg.length != 0) {
            let message = `${looter.data.name} receives: `;
            message += msg.join(",");
            ChatMessage.create({
                user: game.user._id,
                speaker: {
                    actor: containerActor,
                    alias: containerActor.name
                },
                content: message
            });
        }
    }

    game.socket.on(LootSheetEquiNPC.SOCKET, data => {
        console.log("Loot Sheet | Socket Message: ", data);
        if (game.user.isGM && data.processorId === game.user.id) {
            if (data.type === "buy") {
                let buyer = game.actors.get(data.buyerId);
                let seller = canvas.tokens.get(data.tokenId);

                if (buyer && seller && seller.actor) {
                    transaction(seller.actor, buyer, data.itemId, data.quantity);
                }
                else if (!seller) {
                    errorMessageToActor(buyer, "GM not available, the GM must on the same scene to purchase an item.")
                    ui.notifications.error("Player attempted to purchase an item on a different scene.");
                }
            }

            if (data.type === "loot") {
                let looter = game.actors.get(data.looterId);
                let container = canvas.tokens.get(data.tokenId);

                if (looter && container && container.actor) {
                    lootItems(container.actor, looter, data.items);
                }
                else if (!container) {
                    errorMessageToActor(looter, "GM not available, the GM must on the same scene to loot an item.")
                    ui.notifications.error("Player attempted to loot an item on a different scene.");
                }
            }

            if (data.type === "distributeCoins") {
                let container = canvas.tokens.get(data.tokenId);
                if (!container || !container.actor) {
                    errorMessageToActor(looter, "GM not available, the GM must on the same scene to distribute coins.")
                    return ui.notifications.error("Player attempted to distribute coins on a different scene.");
                }
                distributeCoins(container.actor);
            }

            if (data.type === "lootCoins") {
                let looter = game.actors.get(data.looterId);
                let container = canvas.tokens.get(data.tokenId);
                if (!container || !container.actor || !looter) {
                    errorMessageToActor(looter, "GM not available, the GM must on the same scene to loot coins.")
                    return ui.notifications.error("Player attempted to loot coins on a different scene.");
                }
                lootCoins(container.actor, looter);
            }
        }
        if (data.type === "error" && data.targetId === game.user.actorId) {
            console.log("Loot Sheet | Transaction Error: ", data.message);
            return ui.notifications.error(data.message);
        }
    });


});

