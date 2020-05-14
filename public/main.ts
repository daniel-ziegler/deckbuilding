// TODO: if a zone gets bigger and then smaller, it's annoying to keep resizing it. As soon as a zone gets big I want to leave it big probably.
// TODO: lay out the zones a bit more nicely
// TODO: starting to see performance hiccups in big games
// TODO: probably don't want the public move method to allow moves into or out of resolving.

import { Cost, Shadow, State, Card, CardSpec, GameSpec } from './logic.js'
import { Trigger, Replacer, Ability, CalculatedCost } from './logic.js'
import { ID } from './logic.js'
import { renderCost, renderEnergy } from './logic.js'
import { emptyState } from './logic.js'
import { Option, OptionRender, HotkeyHint } from './logic.js'
import { UI, Undo, Victory, HistoryMismatch, ReplayEnded } from './logic.js'
import { playGame, initialState, verifyScore } from './logic.js'
import { mixins } from './logic.js'
import { VERSION } from './logic.js'

// --------------------- Hotkeys

type Key = string

const keyListeners: Map<Key, () => void> = new Map();
const handHotkeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 
    '!','#', '$', '%', '^', '&', '*', '(', ')', '-', '+', '=', '{', '}', '[', ']'] // '@' is confusing
const lowerHotkeys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', // 'z' reserved for undo
]
const upperHotkeys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']
const numHotkeys:Key[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].concat(lowerHotkeys)
const supplyAndPlayHotkeys:Key[] = lowerHotkeys.concat(upperHotkeys)
// want to put zones that are least likely to change earlier, to not distrupt assignment
const hotkeys:Key[] = supplyAndPlayHotkeys.concat(handHotkeys).concat([' '])
const choiceHotkeys:Key[] = handHotkeys.concat(supplyAndPlayHotkeys)

$(document).keydown((e: any) => {
    const listener = keyListeners.get(e.key)
    if (e.altKey || e.ctrlKey || e.metaKey) return
    if (listener != undefined) {
        e.preventDefault()
        listener()
    }
    if (e.key == ' ') { //It's easy and annoying to accidentally hit space
        e.preventDefault()
    }
});

function renderHotkey(hotkey: Key) {
    if (hotkey == ' ') hotkey = '&#x23B5;'
    return `<span class="hotkey">${hotkey}</span> `
}

function interpretHint(hint:HotkeyHint|undefined): Key|undefined {
    if (hint == undefined) return undefined
    switch (hint.kind) {
        case "number":
            const n = hint.val
            if (n < numHotkeys.length) return numHotkeys[n]
            else return undefined
        case "none":
            return ' '
        case "boolean":
            return (hint.val) ? 'y' : 'n'
        case "key":
            return hint.val
        default: assertNever(hint)
    }
}

class HotkeyMapper {
    constructor() {
    }
    map(state:State, options:Option<any>[]): Map<OptionRender, Key> {
        const result:Map<OptionRender, Key> = new Map()
        const taken:Map<Key, OptionRender> = new Map()
        const pickable:Set<OptionRender> = new Set()
        for (const option of options) pickable.add(option.render)
        function takenByPickable(key:Key): boolean {
            const takenBy:OptionRender|undefined = taken.get(key)
            return (takenBy != undefined && pickable.has(takenBy))
        }
        function set(x:OptionRender, k:Key): void {
            result.set(x, k)
            taken.set(k, x)
        }
        function setFrom(cards:Card[], preferredHotkeys:Key[]) {
            const preferredSet:Set<Key> = new Set(preferredHotkeys)
            const otherHotkeys:Key[] = hotkeys.filter(x => !preferredSet.has(x))
            const toAssign:Key[] = (preferredHotkeys.concat(otherHotkeys)).filter(x => !taken.has(x))
            for (const card of cards) {
                let n = card.zoneIndex
                if (n < toAssign.length) {
                    set(card.id, toAssign[n])
                }
            }
        }
        //want to put zones that are most important not to change earlier
        setFrom(state.supply, supplyAndPlayHotkeys)
        setFrom(state.hand, handHotkeys)
        setFrom(state.play, supplyAndPlayHotkeys)
        for (const option of options) {
            const hint:Key|undefined = interpretHint(option.hotkeyHint);
            if (hint != undefined && !result.has(option.render)) {
                if (!takenByPickable(hint))
                    set(option.render, hint)
            }
        }
        let index = 0
        function nextHotkey(): Key|null {
            while (true) {
                const key:Key = hotkeys[index]
                if (!takenByPickable(key)) return key
                else index++
            }
            return hotkeys[index]
        }
        for (const option of options) {
            if (!result.has(option.render)) {
                const key = nextHotkey()
                if (key != null) set(option.render, key)
            }
        }
        return result
    }
}

// ------------------ Rendering State

function assertNever(x: never): never {
    throw new Error(`Unexpected: ${x}`)
}

class TokenRenderer {
    private readonly tokenTypes:string[];
    constructor() {
        this.tokenTypes = ['charge'];
    }
    tokenColor(token:string): string {
        const tokenColors:string[] = ['black', 'red', 'orange', 'green', 'fuchsia', 'blue'] 
        return tokenColors[this.tokenType(token) % tokenColors.length]
    }
    tokenType(token:string): number {
        const n:number = this.tokenTypes.indexOf(token)
        if (n >= 0) return n
        this.tokenTypes.push(token)
        return this.tokenTypes.length - 1
    }
    render(tokens:Map<string, number>): string {
        function f(n:number): string {
            return (n == 1) ? '*' : n.toString()
        }
        const tokenHtmls:string[] = [];
        for (const token of tokens.keys()) {
            this.tokenType(token)
        }
        for (let i = 0; i < this.tokenTypes.length; i++) {
            const token = this.tokenTypes[i]
            const n = tokens.get(token) || 0
            if (n > 0) {
                tokenHtmls.push(`<span id='token' style='color:${this.tokenColor(token)}'>${f(n)}</span>`)
            }
        }
        return (tokenHtmls.length > 0) ? `(${tokenHtmls.join('')})` : ''
    }
    renderTooltip(tokens:Map<string, number>): string {
        function f(n:number, s:string): string {
            return (n == 1) ? s : `${s} (${n})`
        }
        const tokenHtmls:string[] = [];
        for (const token of tokens.keys()) {
            this.tokenType(token)
        }
        for (const token of this.tokenTypes) {
            const n = tokens.get(token) || 0
            if (n > 0) tokenHtmls.push(f(n, token))
        }
        return (tokenHtmls.length > 0) ? `Tokens: ${tokenHtmls.join(',')}` : ''
    }
}

function describeCost(cost:Cost): string {
    const coinCost = (cost.coin > 0) ? [`lose $${cost.coin}`] : []
    const energyCost = (cost.energy > 0) ? [`gain ${renderEnergy(cost.energy)}`] : []
    const costs = coinCost.concat(energyCost)
    const costStr = (costs.length > 0) ? costs.join(' and ') : 'do nothing'
    return `Cost: ${costStr}.`
}


function renderShadow(shadow:Shadow, state:State, tokenRenderer:TokenRenderer):string {
    const card:Card = shadow.spec.card
    const tokenhtml:string = tokenRenderer.render(card.tokens)
    const costhtml:string = renderCost(card.cost(state)) || '&nbsp'
    const ticktext:string = `tick=${shadow.tick}`
    const shadowtext:string = `shadow='true'`
    let tooltip:string;
    switch (shadow.spec.kind) {
        case 'ability':
            tooltip = renderAbility(shadow.spec.ability)
            break
        case 'trigger':
            tooltip = renderStatic(shadow.spec.trigger)
            break
        case 'effect':
            tooltip = card.effect().text
            break
        case 'abilities':
            tooltip = card.abilities().map(renderAbility).join('')
            break
        case 'cost':
            tooltip = describeCost(card.cost(state))
            break
        default: assertNever(shadow.spec)
    }
    return [`<div class='card' ${ticktext} ${shadowtext}>`,
            `<div class='cardbody'>${card}${tokenhtml}</div>`,
            `<div class='cardcost'>${costhtml}</div>`,
            `<span class='tooltip'>${tooltip}</span>`,
            `</div>`].join('')
}

function renderCard(
    card:Card|Shadow,
    state:State,
    options:CardRenderOptions,
    tokenRenderer:TokenRenderer
):string {
    if (card instanceof Shadow) {
        return renderShadow(card, state, tokenRenderer)
    } else {
        const tokenhtml:string = tokenRenderer.render(card.tokens)
        const costhtml:string = renderCost(card.cost(state)) || '&nbsp'
        const picktext:string = (options.pick !== undefined) ? `<div class='pickorder'>${options.pick}</div>` : ''
        const choosetext:string = (options.option !== undefined) ? `choosable chosen='false' option=${options.option}` : ''
        const hotkeytext:string = (options.hotkey !== undefined) ? renderHotkey(options.hotkey) : ''
        const ticktext:string = `tick=${card.ticks[card.ticks.length-1]}`
        return [`<div class='card' ${ticktext} ${choosetext}> ${picktext}`,
                `<div class='cardbody'>${hotkeytext}${card}${tokenhtml}</div>`,
                `<div class='cardcost'>${costhtml}</div>`,
                `<span class='tooltip'>${renderTooltip(card, state, tokenRenderer)}</span>`,
                `</div>`].join('')
    }
}

function renderStatic(x:Trigger|Replacer): string {
    return `<div>(static) ${x.text}</div>`
}

function renderAbility(x:Ability): string {
    return `<div>(ability) ${x.text}</div>`
}

function renderCalculatedCost(c:CalculatedCost): string {
    return `<div>(cost) ${c.text}</div>`
}

function renderTooltip(card:Card, state:State, tokenRenderer:TokenRenderer): string {
    const effectHtml:string = `<div>${card.effect().text}</div>`
    const costHtml:string = (card.spec.calculatedCost != undefined) ? renderCalculatedCost(card.spec.calculatedCost) : ''
    const abilitiesHtml:string = card.abilities().map(x => renderAbility(x)).join('')
    const triggerHtml:string = card.triggers().map(x => renderStatic(x)).join('')
    const replacerHtml:string = card.replacers().map(x => renderStatic(x)).join('')
    const staticHtml:string = triggerHtml + replacerHtml
    const tokensHtml:string = tokenRenderer.renderTooltip(card.tokens)
    const baseFilling:string = [costHtml, effectHtml, abilitiesHtml, staticHtml, tokensHtml].join('')
    function renderRelated(spec:CardSpec) {
        const card:Card = new Card(spec, -1)
        const costStr = renderCost(card.cost(emptyState))
        const header = (costStr.length > 0) ?
            `<div>---${card.toString()} (${costStr})---</div>` :
            `<div>-----${card.toString() }----</div>`
        return header + renderTooltip(card, state, tokenRenderer)
    }
    const relatedFilling:string = card.relatedCards().map(renderRelated).join('')
    return `${baseFilling}${relatedFilling}`
}


function render_log(msg: string) {
  return `<div class=".log">${msg}</div>`
}

interface CardRenderOptions {
    option?: number;
    pick?: number;
    hotkey?: Key;
}

function getIfDef<S, T>(m:Map<S, T>|undefined, x:S): T|undefined {
    return (m == undefined) ? undefined : m.get(x)
}

interface RenderSettings {
    hotkeyMap?: Map<number|string, Key>;
    optionsMap?: Map<number, number>;
    pickMap?: Map<number|string, number>;
}

declare global {
    interface Window { renderedState: State; serverSeed?: string; }
}

interface RendererState {
    hotkeysOn:boolean;
    hotkeyMapper: HotkeyMapper;
    tokenRenderer: TokenRenderer;
}

const globalRendererState:RendererState = {
    hotkeysOn:false,
    hotkeyMapper: new HotkeyMapper(),
    tokenRenderer: new TokenRenderer(),
}

function resetGlobalRenderer() {
    globalRendererState.hotkeyMapper = new HotkeyMapper()
    globalRendererState.tokenRenderer = new TokenRenderer()
}

function renderState(state:State,
    settings:RenderSettings = {},
): void {
    window.renderedState = state
    clearChoice()
    function render(card:Card|Shadow) {
        const cardRenderOptions:CardRenderOptions = {
            option: getIfDef(settings.optionsMap, card.id),
            hotkey: getIfDef(settings.hotkeyMap, card.id),
            pick: getIfDef(settings.pickMap, card.id),
        }
        return renderCard(card, state, cardRenderOptions, globalRendererState.tokenRenderer)
    }
    $('#resolvingHeader').html('Resolving:')
    $('#energy').html(state.energy.toString())
    $('#coin').html(state.coin.toString())
    $('#points').html(state.points.toString())
    $('#aside').html(state.aside.map(render).join(''))
    $('#resolving').html(state.resolving.map(render).join(''))
    $('#play').html(state.play.map(render).join(''))
    $('#supply').html(state.supply.map(render).join(''))
    $('#hand').html(state.hand.map(render).join(''))
    $('#deck').html(state.deck.map(render).join(''))
    $('#discard').html(state.discard.map(render).join(''))
    $('#log').html(state.logs.slice().reverse().map(render_log).join(''))
}


// ------------------------------- Rendering choices

const webUI:UI = {
    choice<T>(
        state: State,
        choicePrompt: string,
        options: Option<T>[],
    ): Promise<number> {
        return new Promise(function(resolve, reject) {
            function pick(i:number) {
                clearChoice()
                resolve(i)
            }
            function renderer() {
                renderChoice(state,
                    choicePrompt,
                    options.map((x, i) => ({...x, value:() => pick(i)})),
                    reject, renderer)
            }
            renderer()
        })
    },
    multichoice<T>(
        state: State,
        choicePrompt: string,
        options: Option<T>[],
        validator:((xs:T[]) => boolean) = (xs => true)
    ): Promise<number[]> {
        return new Promise(function(resolve, reject){
            const chosen:Set<number> = new Set()
            function chosenOptions(): T[] {
                const result = []
                for (let i of chosen) result.push(options[i].value)
                return result
            }
            function isReady(): boolean {
                return validator(chosenOptions())
            }
            const submitIndex = options.length
            function setReady(): void {
                if (isReady()) {
                    $(`[option='${submitIndex}']`).attr('choosable', 'true')
                } else {
                    $(`[option='${submitIndex}']`).removeAttr('choosable')
                }
            }
            function elem(i:number): any {
                return $(`[option='${i}']`)
            }
            function picks(): Map<ID|string, number> {
                const result = new Map<ID|string, number>()
                var i = 0;
                for (const k of chosen) {
                    result.set(options[k].render, i++)
                }
                return result
            }
            function pick(i:number): void {
                if (chosen.has(i)) {
                    chosen.delete(i)
                    elem(i).attr('chosen', false)
                } else {
                    chosen.add(i)
                    elem(i).attr('chosen', true)
                }
                renderer()
                setReady()
            }
            const newOptions:Option<() => void>[] = options.map(
                (x, i) => ({...x, value: () => pick(i)})
            )
            const hint:HotkeyHint = {kind:'key', val:' '}
            newOptions.push({render:'Done', hotkeyHint: hint, value: () => {
                if (isReady()) {
                    resolve(Array.from(chosen.values()))
                }
            }})
            chosen.clear()
            function renderer() {
                renderChoice(state, choicePrompt, newOptions, reject, renderer, picks)
                for (const j of chosen) elem(j).attr('chosen', true)
            }
            renderer()
        })
    },
    async victory(state:State): Promise<void> {
        const submitOrUndo: () => Promise<void> = () => 
            new Promise(function (resolve, reject) {
                heartbeat(state.spec)
                const submitDialog = () => {
                    keyListeners.clear()
                    renderScoreSubmission(state, () => submitOrUndo().then(resolve, reject))
                }
                const options:Option<() => void>[] = (!submittable(state.spec)) ? [] : [{
                        render: 'Submit', 
                        value: submitDialog,
                        hotkeyHint: {kind:'key', val:'!'}
                    }]
                renderChoice(state, `You won using ${state.energy} energy!`,
                    options, () => resolve(), () => {})
            })
        return submitOrUndo()
    }
}

interface StringOption<T> {
    render: string,
    value: T
}


function renderChoice(
    state: State,
    choicePrompt: string,
    options: Option<() => void>[],
    reject:((x:any) => void),
    renderer:() => void,
    picks?: () => Map<ID|string, number>,
): void {

    const optionsMap:Map<number,number> = new Map() //map card ids to their position in the choice list
    const stringOptions:StringOption<number>[] = [] // values are indices into options
    for (let i = 0; i < options.length; i++) {
        const rendered:OptionRender = options[i].render
        if (typeof rendered == 'string') {
            stringOptions.push({render:(rendered as string), value:i})
        } else if (typeof rendered === 'number') {
            optionsMap.set((rendered as ID), i)
        }
    }

    let hotkeyMap:Map<OptionRender,Key>;
    let pickMap:Map<OptionRender,number>;
    if (globalRendererState.hotkeysOn) {
        hotkeyMap = globalRendererState.hotkeyMapper.map(state, options)
    }
    else {
        hotkeyMap = new Map()
    }
    if (picks != undefined) {
        pickMap = picks()
    } else {
        pickMap = new Map()
    }

    renderState(state, {hotkeyMap: hotkeyMap, optionsMap:optionsMap, pickMap:pickMap})

    $('#choicePrompt').html(choicePrompt)
    $('#options').html(stringOptions.map(localRender).join(''))
    $('#undoArea').html(renderSpecials(state.undoable()))
    bindSpecials(state, reject, renderer)

    function elem(i:number): any {
        return $(`[option='${i}']`)
    }
    for (let i = 0; i < options.length; i++) {
        const option = options[i];
        const f: () => void = option.value;
        elem(i).on('click', f)
        let hotkey:Key|undefined = hotkeyMap.get(option.render)
        if (hotkey != undefined) keyListeners.set(hotkey, f)
    }

    function localRender(option:StringOption<number>): string {
        return renderStringOption(option, hotkeyMap.get(option.render), pickMap.get(option.render))
    }

}

function renderStringOption(option:StringOption<number>, hotkey?:Key, pick?:number): string {
    const hotkeyText = (hotkey!==undefined) ? renderHotkey(hotkey) : ''
    const picktext:string = (pick !== undefined) ? `<div class='pickorder'>${pick}</div>` : ''
    return `<span class='option' option='${option.value}' choosable chosen='false'>${picktext}${hotkeyText}${option.render}</span>`
}

function renderSpecials(undoable:boolean): string {
    return renderUndo(undoable) + renderHotkeyToggle() + renderHelp()
}

function renderHotkeyToggle(): string {
    return `<span class='option', option='hotkeyToggle' choosable chosen='false'>${renderHotkey('/')} Hotkeys</span>`
}
function renderHelp(): string {
    return `<span id='help' class='option', option='help' choosable chosen='false'>${renderHotkey('?')} Help</span>`
}

function renderUndo(undoable:boolean): string {
    const hotkeyText = renderHotkey('z')
    return `<span class='option', option='undo' ${undoable ? 'choosable' : ''} chosen='false'>${hotkeyText}Undo</span>`
}

function bindSpecials(state:State, reject: ((x:any) => void), renderer: () => void): void {
    bindHotkeyToggle(renderer)
    bindUndo(state, reject)
    bindHelp(state, renderer)
}

function bindHotkeyToggle(renderer: () => void) {
    function pick() {
        globalRendererState.hotkeysOn = !globalRendererState.hotkeysOn
        renderer()
    }
    keyListeners.set('/', pick)
    $(`[option='hotkeyToggle']`).on('click', pick)
}

function bindUndo(state:State, reject: ((x:any) => void)): void {
    function pick() {
        if (state.undoable()) reject(new Undo(state))
    }
    keyListeners.set('z', pick)
    $(`[option='undo']`).on('click', pick)
}

function clearChoice(): void {
    keyListeners.clear()
    $('#choicePrompt').html('')
    $('#options').html('')
    $('#undoArea').html('')
}


// ------------------------------------------ Help

function bindHelp(state:State, renderer: () => void) {
    function attach(f: () => void) {
        $('#help').on('click', f)
        keyListeners.set('?', f)
    }
    function pick() {
        attach(renderer)
        const helpLines:string[] = [
            'The goal of the game is to get to 50 points (vp) using as little energy (@) as possible.',
            "When you play or buy a card, follow its instructions. After playing a card, discard it.",
            "You can pay a card's cost in order to buy it from the supply or play it from your hand.",
            "The symbols below a card's name indicate its cost.",
            "When a cost is measured in energy (@, @@, ...) then you use that much energy to play it.",
            "When a cost is measured in coin ($) then you can only buy it if you have enough coin.",
            "'Recycling' cards means to put them on the bottom of your deck (preserving their order).",
            "You can activate the abilities of cards in play, marked with (ability).",
            "Effects marked with (static) apply whenever the card is in play or in the supply.",
            "The game is played with a kingdom of 7 core cards and 12 randomized cards.",
            `You can play today's <a href='daily'>daily kingdom</a>, which refreshes midnight EDT.`,
            `Or you can visit <a href="${replayURL(state.spec)}">this link</a> to replay this kingdom anytime.`,
            `Or visit the <a href="picker.html">kingdom picker<a> to pick a kingdom.`,
        ]
        if (submittable(state.spec))
            helpLines.push(`Check out the scoreboard <a href=${scoreboardURL(state.spec)}>here</a>.`)
        else 
            helpLines.push(`There is no scoreboard when you specify a kingdom manually.`)
        $('#choicePrompt').html('')
        $('#resolvingHeader').html('')
        $('#resolving').html(helpLines.map(x => `<div class='helpLine'>${x}</div class='helpline'>`).join(''))
    }
    attach(pick)
}

//TODO: many of the URLs seem wrong
//TODO: play is not successfuly defaulting to a random seed
//TODO: make it so that you combine the daily seed

function dateString() {
    const date = new Date()
    return (String(date.getMonth() + 1)) + String(date.getDate()).padStart(2, '0') + date.getFullYear()
}

function dateSeedURL() {
    return `play?seed=${dateString()}`
}


function replayURL(spec:GameSpec) {
    const args:string[] = [`seed=${spec.seed}`]
    if (spec.kingdom != null) args.push(`kingdom=${spec.kingdom}`)
    return `play?${args.join('&')}`
}

// ------------------------------ High score submission

//TODO: allow submitting custom kingdoms
function submittable(spec:GameSpec): boolean {
    return (spec.kingdom == null)
}


function setCookie(name:string,value:string) {
    document.cookie = `${name}=${value}; max-age=315360000; path=/`
}
function getCookie(name:string): string|null {
    let nameEQ:string = name + "=";
    let ca:string[] = document.cookie.split(';');
    for(let c of document.cookie.split(';')) {
        while (c.charAt(0)==' ') c = c.substring(1,c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
    }
    return null;
}
function rememberUsername(username:string) {
    setCookie('username', username)
}
function getUsername():string|null {
    return getCookie('username')
}


function renderScoreSubmission(state:State, done:() => void) {
    const score = state.energy
    const seed = state.spec.seed
    $('#scoreSubmitter').attr('active', 'true')
    const pattern = "[a-ZA-Z0-9]"
    $('#scoreSubmitter').html(
        `<label for="username">Name:</label>` +
        `<textarea id="username"></textarea>` +
        `<div>` +
        `<span class="option" choosable id="submitScore">${renderHotkey('⏎')}Submit</span>` +
        `<span class="option" choosable id="cancelSubmit">${renderHotkey('Esc')}Cancel</span>` +
        `</div>`
    )
    const username = getUsername()
    if (username != null) $('#username').val(username)
    $('#username').focus()
    function exit() {
        $('#scoreSubmitter').attr('active', 'false')
        done()
    }
    function submit() {
        const username:string = $('#username').val() as string
        if (username.length > 0) {
            rememberUsername(username)
            const query = [
                `seed=${seed}`,
                `score=${score}`,
                `username=${username}`,
                `history=${state.serializeHistory()}`
            ].join('&')
            $.post(`submit?${query}`).done(function(resp:string) {
                if (resp == 'OK') {
                    heartbeat(state.spec)
                } else {
                    alert(resp)
                }
            })
            exit()
        }
    }
    $('#username').keydown((e:any) => {
        if (e.keyCode == 13) {
            submit()
            e.preventDefault()
        } else if (e.keyCode == 8) {
        } else if (e.keyCode == 189) {
        } else if (e.keyCode == 27) {
            exit()
            e.preventDefault()
        } else if (e.keyCode < 48 || e.keyCode > 90) {
            e.preventDefault()
        }
    })
    $('#submitScore').on('click', submit)
    $('#cancelSubmit').on('click', exit)
}

function scoreboardURL(spec:GameSpec) {
    return `scoreboard?seed=${spec.seed}`
}

//TODO: live updates?
function heartbeat(spec:GameSpec, interval?:any): void {
    if (spec.kingdom == null) {
        $.get(`topScore?seed=${spec.seed}&version=${VERSION}`).done(function(x:string) {
            if (x == 'version mismatch') {
                clearInterval(interval)
                alert("The server has updated to a new version, please refresh.")
            }
            console.log(x)
            const n:number = parseInt(x, 10)
            if (!isNaN(n)) renderBest(n, spec)
        })
    }
}

function renderBest(best:number, spec:GameSpec): void {
    $('#best').html(`Fastest win on this seed: ${best} (<a href='${scoreboardURL(spec)}'>scoreboard</a>)`)
}


// Creating the game spec and starting the game ------------------------------

function makeGameSpec(): GameSpec {
    return {seed:getSeed(), kingdom:getKingdom(), testing:isTesting()}
}

function isTesting(): boolean {
    return new URLSearchParams(window.location.search).get('test') != null
}

function getKingdom(): string|null {
    return new URLSearchParams(window.location.search).get('kingdom')
}

function getSeed(): string {
    const seed:string|null = new URLSearchParams(window.location.search).get('seed')
    const urlSeed:string[] = (seed == null || seed.length == 0) ? [] : [seed]
    const windowSeed:string[] = (window.serverSeed == undefined || window.serverSeed.length == 0) ? [] : [window.serverSeed]
    const seeds:string[] = windowSeed.concat(urlSeed)
    return (seeds.length == 0) ? Math.random().toString(36).substring(2, 7) : seeds.join('.')
}

export function load(): void {
    const spec:GameSpec = makeGameSpec()
    heartbeat(spec)
    const interval:any = setInterval(() => heartbeat(spec, interval), 10000)
    playGame(initialState(spec).attachUI(webUI))
}

// ----------------------------------- Kingdom picker
//

function kingdomURL(specs:CardSpec[]) {
    return `play?kingdom=${specs.map(card => card.name).join(',')}`
}

//TODO: refactor the logic into logic.ts, probably just state initialization
export function loadPicker(): void {
    let state = emptyState;
    const specs = mixins.slice()
    specs.sort((spec1, spec2) => spec1.name.localeCompare(spec2.name))
    for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]
        state = state.addToZone(new Card(spec, i), 'supply')
    }
    function trivial() {}
    function elem(i:number): any {
        return $(`[option='${i}']`)
    }
    function prefix(s:string): string {
        const parts:string[] = s.split('/')
        return parts.slice(0, parts.length-1).join('/')
    }
    function kingdomLink(): string {
        return kingdomURL(Array.from(chosen.values()).map(i => specs[i]))
    }
    const chosen:Set<number> = new Set()
    function pick(i:number): void {
        if (chosen.has(i)) {
            chosen.delete(i)
            elem(i).attr('chosen', false)
        } else {
            chosen.add(i)
            elem(i).attr('chosen', true)
        }
        $('#count').html(String(chosen.size))
        if (chosen.size > 0) {
            $('#kingdomLink').attr('href', kingdomLink())
        } else {
            $('#kingdomLink').removeAttr('href')
        }
    }
    renderChoice(state,
        'Choose which cards to include in the supply.',
        state.supply.map((card, i) => ({
            render: card.id,
            value: () => pick(i)
        })), trivial, trivial)
}
