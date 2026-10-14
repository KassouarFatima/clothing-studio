import React from 'react'
import state from '../store'
import { useSnapshot } from 'valtio'
import { getContrastingColor } from '../config/helpers'
const generateStyle = (type, snap) => {
    if (type === 'filled') {
        return {
            backgroundColor: snap.color,
            color: getContrastingColor(snap.color)
        }
        
    }else if(type==='outline'){
      return{
        borderWidth:"1px",
        borderColor:snap.color,
        color:snap.color
      }
    }

}
const CustomButtom = ({ type, title, customStyles, handleClick, disabled }) => {
    const snap = useSnapshot(state)
    return (
        <button className={`px-2 py-1.5 flex-1 rounded-md ${customStyles}`}
            style={generateStyle(type, snap)}
            onClick={handleClick}
            disabled={disabled}>

            {title}

        </button>
    )
}

export default CustomButtom